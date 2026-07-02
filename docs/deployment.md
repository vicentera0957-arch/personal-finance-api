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

- **Observabilidad:** falta **tracing distribuido** y **error tracking (Sentry)**.
  Métricas (Prometheus, `/metrics`) y logs estructurados (pino) ya están en su lugar.
- **CD:** el CI construye la imagen (`docker-build`) pero con `push: false` — nadie la
  publica a un registry ni la deploya. El deploy hoy es manual. Falta un job que
  pushee a GHCR/registry en push a `main` (o en tag).
- **Borrado de usuario:** `DELETE /users/:id` confía en el `ON DELETE CASCADE` desde
  `users` para limpiar accounts/categories/transactions/budgets/refresh_tokens. La
  dirección es correcta, pero el camino **no tiene test de integración** que borre un
  usuario con grafo completo, y conviven `CASCADE` (desde user) con `RESTRICT`
  (transactions→accounts, transactions/budgets→categories) en un diamante cuyo orden
  de resolución en Postgres no está verificado. Ver nota abajo.

> **Resuelto (eran pendientes):** los integration tests viven en `test/integration/`
> (sin `.bak`) y corren en CI (`integration-tests` contra Postgres+Redis reales). El
> build de la imagen Docker es un job de CI (`docker-build`). Las métricas Prometheus
> (`/metrics`) están activas.

### Nota — borrado de usuario y el diamante CASCADE/RESTRICT

El grafo de FKs (en `InitialSchema`) es:

```
users ──CASCADE──▶ accounts, categories, transactions, budgets, refresh_tokens
transactions ──RESTRICT──▶ accounts
transactions ──RESTRICT──▶ categories
budgets ──RESTRICT──▶ categories
```

El `CASCADE` desde `users` es el diseño correcto para "borrá mi cuenta y no dejes datos
a la deriva". El `RESTRICT` cruzado también es correcto para el flujo normal: impide
borrar una cuenta/categoría que aún tiene transacciones (→ `AccountInUseException` /
`CategoryInUseException`, 409).

El riesgo está en la **combinación**: al borrar un user, Postgres debe cascadear tanto
`accounts` como `transactions`. `RESTRICT` se chequea de inmediato (no es diferible,
a diferencia de `NO ACTION`), así que si el cascade intenta borrar la cuenta **antes**
de que el cascade de transactions termine, el `RESTRICT` puede dispararse y abortar todo
el borrado con un FK violation. El comportamiento depende del orden de resolución y
**no está testeado**. Antes de exponer el endpoint a usuarios reales:

1. Escribir un integration test que cree user → account → category → transaction → budget
   y luego `DELETE /users/:id`, verificando que todo desaparece (o falla limpio).
2. Si el diamante falla: o las aristas cruzadas pasan a `NO ACTION` (chequeo diferido al
   fin del statement — pero se pierde el guard 409 a nivel DB), o el borrado se hace en
   orden explícito en la capa de aplicación dentro de una transacción.
3. Independiente del resultado: hard-delete es **irreversible**. Para datos financieros,
   los backups de la DB son la red de seguridad real (ver pendiente de runbook de backups).
