# Deployment runbook

Guía para desplegar la Personal Finance API. Pensada para un primer deploy: explica
el **qué** y el **por qué**. Es agnóstica de plataforma; al final hay notas por plataforma.

---

## Modelo mental: Build → Release → Run (12-factor)

```
BUILD    docker build  →  imagen inmutable con dist/ + deps de prod
RELEASE  migration:run  →  el schema de la DB queda al día (ANTES de levantar la app)
RUN      node dist/main →  la app sirve tráfico
```

Las tres fases están separadas a propósito. La imagen es la misma en cualquier entorno;
lo único que cambia entre dev/staging/prod son las **variables de entorno**.

---

## 1. Empaquetado (imagen Docker)

Dockerfile **multi-stage** (`./Dockerfile`):

- **Stage build:** `npm ci` (todas las deps) + `nest build` → `dist/`.
- **Stage runtime:** `node:20-alpine`, solo `npm ci --omit=dev`, copia `dist/`, usuario
  no-root, `tini` como PID 1 (reenvía SIGTERM para que `enableShutdownHooks()` cierre limpio).

```bash
docker build -t personal-finance-api:latest .
```

El `.dockerignore` evita hornear `node_modules`, `.env`, tests y docs en la imagen.
**Los secretos nunca van en la imagen** — se inyectan por env de la plataforma.

---

## 2. Release phase (migraciones)

El `docker-entrypoint.sh` corre `migration:run` (sobre `dist/data-source.js`) **antes**
de arrancar la app. Si una migración falla, el contenedor no levanta (preferible a
correr código nuevo contra un schema viejo).

- Saltar migraciones en el contenedor de la app: `RUN_MIGRATIONS=false`
  (úsalo si las corrés en un Job/initContainer separado — patrón recomendado en Kubernetes).
- Manual dentro del contenedor: `npm run migration:run:prod`
- Ver estado: `npm run migration:show:prod`

> El `data-source.ts` detecta si corre compilado (`.js`→`dist/`) o por ts-node (`.ts`→`src/`),
> así el **mismo** archivo sirve para dev y para la imagen de prod.

Para cambios de schema sin downtime, seguir **expand/contract**:
`EXPAND (col nullable) → BACKFILL → MIGRATE (lee la nueva) → CONTRACT (drop la vieja)`.

---

## 3. Configuración (variables de entorno)

Validadas por Joi al arrancar (`src/config/env.validation.ts`) — si falta una required
o `CORS_ORIGIN='*'` en prod, **la app no arranca** (fail-fast).

| Variable | Prod | Nota |
|---|---|---|
| `NODE_ENV` | `production` | desactiva `synchronize`, logs JSON |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | **requeridas, ≥32 chars** | generar con `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | requeridas | credenciales de la DB gestionada |
| `DB_SSL` | `true` | exigido por Neon/Supabase/RDS |
| `DB_SSL_REJECT_UNAUTHORIZED` | `true` | `false` solo con cert self-signed |
| `DB_POOL_MAX` | ~10 | ajustar al límite de conexiones del server |
| `CORS_ORIGIN` | dominios explícitos | **no** `'*'` |
| `TRUST_PROXY` | `1` (o nº de proxies) | detrás de LB, para IP real del cliente |
| `REDIS_HOST/PORT/PASSWORD` | requeridas | cache + throttler multi-instancia |
| `SWAGGER_ENABLED` | `false` opcional | si no querés exponer el spec |

---

## 4. Health checks

- **Liveness** `GET /health` → 200 si el proceso vive. Si falla → el orquestador **reinicia**.
- **Readiness** `GET /ready` → 200 si la DB responde, 503 si no. Si falla → el orquestador
  **deja de routear** tráfico (sin reiniciar). Un blip transitorio de DB no mata el contenedor.

Ambas son públicas y están fuera del prefix `api/v1`.

---

## 5. Verificación post-deploy

```bash
curl -f https://<host>/health    # 200
curl -f https://<host>/ready     # 200 (503 si la DB está caída)
# smoke: registrar y loguear
curl -X POST https://<host>/api/v1/auth/register -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"Str0ng!pass","name":"Test"}'
```

---

## Notas por plataforma

- **PaaS (Render / Railway / Fly.io):** apuntá la build al `Dockerfile`. TLS y health checks
  los da la plataforma (configurá `/ready`). Migraciones: las corre el entrypoint, o usá el
  "release command" de la plataforma con `RUN_MIGRATIONS=false` en la app. Secrets en el panel.
- **Kubernetes:** `Deployment` con `livenessProbe: /health` y `readinessProbe: /ready`;
  migraciones en un `initContainer` o `Job` (`RUN_MIGRATIONS=false` en el pod de la app);
  `Secret`/`ConfigMap` para env; `TRUST_PROXY=1` por el Ingress.
- **VPS con Docker:** reverse proxy (nginx/Caddy) para TLS, `TRUST_PROXY=1`, `.env` fuera del
  repo (`--env-file`), `docker compose` para orquestar app + Postgres + Redis.

## Pendientes conocidos (no bloquean el primer deploy)

- Restaurar los integration tests (`test/integration/*.bak`) y activarlos en CI.
- Observabilidad: métricas (Prometheus) + tracing + error tracking (Sentry).
- Build de la imagen Docker como job de CI (catch temprano de errores del Dockerfile).
