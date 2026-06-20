# Production Readiness — 2026-06

Registro de los cambios de esta sesión para acercar la API a "listo para producción":
CI endurecido, fail-fast de secretos, Redis como dependencia dura en el readiness,
normalización de fin de línea y escaneo de dependencias. Cada sección dice **qué**,
**por qué** y enlaza la **documentación oficial** de la tecnología/detalle usado.

---

## Resumen de archivos tocados

**Creados**

| Archivo | Para qué |
| --- | --- |
| `.gitattributes` | Forzar LF en el repo (raíz del lint roto en Windows) |
| `.github/dependabot.yml` | PRs automáticos de actualización (npm + GitHub Actions) |
| `src/shared/infrastructure/health/redis-health.indicator.ts` | Health indicator de Redis para `/ready` |
| `src/shared/infrastructure/health/redis-health.indicator.spec.ts` | Tests del indicator (up/down) |
| `docs/production-readiness-2026-06-16.md` | Este documento |

**Modificados**

| Archivo | Cambio |
| --- | --- |
| `.github/workflows/ci.yml` | Reescritura: concurrency, permissions, env DRY, Redis service, gating `needs`, cobertura, timeouts + jobs `docker-build` y `security-audit` |
| `.prettierrc` | `endOfLine: "lf"` → `"auto"` (tolera CRLF local) |
| `src/config/env.validation.ts` | DB_* y REDIS_HOST `required()` en producción |
| `src/shared/domain/cache/cache-store.port.ts` | Método `ping()` en el port |
| `src/shared/infrastructure/cache/redis-cache-store.ts` | Implementación de `ping()` |
| `src/shared/infrastructure/health/health.module.ts` | Registra `RedisHealthIndicator` |
| `src/shared/infrastructure/health/health.controller.ts` | `/ready` chequea Redis además de la DB |
| _(17 archivos más)_ | Reformateo `prettier` vía `lint:fix` (solo formato) |

**Verificación final:** build limpio · lint 0 errores · **595 unit tests verdes**.

---

## 1. CI endurecido (`.github/workflows/ci.yml`)

7 jobs: `lint`, `build`, `unit-tests`, `integration-tests`, `migration-smoke`,
`docker-build`, `security-audit`.

### Qué se agregó y por qué

- **`concurrency` + `cancel-in-progress`** — varios pushes al mismo PR cancelan los runs
  viejos en vuelo; no se queman minutos verificando código ya obsoleto.
  → https://docs.github.com/en/actions/using-jobs/using-concurrency
- **`permissions: contents: read`** — menor privilegio para el `GITHUB_TOKEN` (por defecto
  puede escribir); el CI sólo lee código.
  → https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
  · https://docs.github.com/en/actions/using-jobs/assigning-permissions-to-jobs
- **`env` a nivel workflow/job (DRY)** — versión de Node y secretos dummy de test en un
  solo lugar (son de juguete, nunca tocan prod).
  → https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables
- **Service container de Redis** en integración — la suite levanta el `AppModule` completo,
  que construye un cliente Redis; antes faltaba y pasaba "de suerte".
  → https://docs.github.com/en/actions/using-containerized-services/about-service-containers
  · https://docs.github.com/en/actions/using-containerized-services/creating-redis-service-containers
- **`needs: build`** en los jobs pesados (integración, docker) — no se levantan contenedores
  ni se buildea imagen si el TS no compila.
  → https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow#defining-prerequisite-jobs
- **Cobertura real** en unit-tests (`test:cov`) — los `coverageThreshold` del `package.json`
  no gateaban porque `npm test` no pasa `--coverage`.
  → https://jestjs.io/docs/configuration#coveragethreshold-object
- **`timeout-minutes` por job** — sin esto un job colgado corre hasta el default de 6 h.
  → https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow#jobsjob_idtimeout-minutes
- **`cache: npm` en setup-node** — baja deps del cache, no de la red.
  → https://github.com/actions/setup-node#caching-global-packages-data
- **Smoke de migraciones con re-run idempotente** — la segunda corrida debe ser no-op;
  si vuelve a migrar, hay una migración no determinista.
  → https://typeorm.io/migrations

### Job `docker-build` (#3)

Buildea la imagen en cada PR (sin push) para atrapar errores del `Dockerfile`/entrypoint
temprano, con cache de capas vía GitHub Actions.

- `docker/setup-buildx-action` → https://github.com/docker/setup-buildx-action
- `docker/build-push-action` → https://github.com/docker/build-push-action
- Cache `type=gha` → https://docs.docker.com/build/cache/backends/gha/
- Multi-stage (contexto del Dockerfile) → https://docs.docker.com/build/building/multi-stage/

### Job `security-audit` (#4)

`npm audit --audit-level=high`, **gate real (bloqueante)**. Tras el `npm audit fix` de
esta sesión el proyecto quedó en **0 high / 0 critical** (ver §6), así que el gate pasa.
Gatea en high/critical, no en moderate.

- `npm audit` / `--audit-level` → https://docs.npmjs.com/cli/v10/commands/npm-audit
- `continue-on-error` → https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow#jobsjob_idcontinue-on-error

---

## 2. Fail-fast de secretos en producción (`src/config/env.validation.ts`)

`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` y `REDIS_HOST` ahora son `required()` cuando
`NODE_ENV=production` (vía `Joi.when`); en dev/test conservan su `default`. Antes, un deploy
con la var olvidada arrancaba **silenciosamente** con credenciales de dev en vez de fallar.

Verificado: prod sin `DB_PASSWORD` → la app no arranca · prod completo → pasa · dev vacío → defaults.

- Joi `any.when()` → https://joi.dev/api/#anywhencondition-options
- NestJS config + validación de schema → https://docs.nestjs.com/techniques/configuration#schema-validation
- 12-factor III. Config → https://12factor.net/config

---

## 3. Redis como dependencia dura en el readiness

El `ThrottlerGuard` global usa Redis como storage; su `increment()` **rechaza** si Redis
no responde → sin Redis, cada request muere con 500. Decisión tomada: tratar Redis como
**dependencia dura** y reflejarlo en `/ready`, para que el orquestador deje de routear
tráfico (503) cuando Redis cae, en vez de mandar requests que van a fallar igual.

Implementación:
- `ICacheStore.ping()` nuevo en el port + impl (`RedisCacheStore`) — reutiliza la conexión
  existente del cache, sin abrir una tercera.
- `RedisHealthIndicator` con `HealthIndicatorService` (API no-deprecada de Terminus 11).
- `/ready` ahora corre `db.pingCheck` **y** `redis.isHealthy`.

Liveness (`/health`) vs readiness (`/ready`): la primera reinicia el contenedor si falla;
la segunda solo deja de routear (un blip de Redis no debe matar el pod).

- NestJS Terminus (healthchecks) → https://docs.nestjs.com/recipes/terminus
- Custom health indicator → https://docs.nestjs.com/recipes/terminus#custom-health-indicators
- Rate limiting / throttler → https://docs.nestjs.com/security/rate-limiting
- Storage Redis del throttler → https://www.npmjs.com/package/@nest-lab/throttler-storage-redis
- ioredis (cliente) → https://github.com/redis/ioredis
- Liveness vs readiness probes (K8s) → https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/

---

## 4. Normalización de fin de línea (`.gitattributes` + `.prettierrc`)

**Problema:** sin `.gitattributes`, el fin de línea dependía del `core.autocrlf` de cada
máquina. En este working copy Windows (CRLF) el `npm run lint` escupía ~8500 errores `␍`
en TODOS los archivos; en CI (Linux/LF) pasaba. Lint local inutilizable + diffs ruidosos.

**Fix:**
- `.gitattributes` con `* text=auto eol=lf` → git guarda siempre LF (garantía fuerte).
  `*.sh eol=lf` aparte: un CRLF en el shebang del `docker-entrypoint.sh` rompe el arranque
  en Alpine.
- `.prettierrc` `endOfLine: "auto"` → prettier tolera el CRLF del working tree local sin
  convertir nada destructivo; la garantía LF queda en la capa git.
- `npm run lint:fix` corrigió 137 errores de formato `prettier/prettier` preexistentes
  (que también fallaban en CI/Linux, no eran CRLF).

- `gitattributes` → https://git-scm.com/docs/gitattributes
- GitHub: configurar fin de línea → https://docs.github.com/en/get-started/git-basics/configuring-git-to-handle-line-endings
- Prettier `endOfLine` → https://prettier.io/docs/options#end-of-line

---

## 5. Dependabot (`.github/dependabot.yml`)

PRs automáticos de actualización: ecosistema `npm` (con majors separados de minor/patch)
y `github-actions` (mantiene las actions de los workflows al día). El `security-audit`
**detecta**, Dependabot **propone** el fix, el CI lo **valida** antes de mergear.

- Opciones del `dependabot.yml` → https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file
- `groups` → https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/controlling-dependencies-updated#grouping-dependencies

---

## 6. Resolución de vulnerabilidades (`npm audit fix`)

`npm audit fix` (sin `--force` → solo parches dentro del semver actual, sin breaking
changes). Solo tocó `package-lock.json`; las deps directas no se movieron.

- **Antes:** 42 vulnerabilities (1 low, 31 moderate, 9 high, 1 critical).
- **Después:** 20 moderate, **0 high, 0 critical**. Eliminadas: el critical (handlebars,
  no alcanzable en esta app), los 9 high (incl. `path-to-regexp` DoS en el routing de
  `@nestjs/core`/`platform-express`, la única con impacto runtime real) y la low.
- **595 unit tests verdes** tras el fix.

Las **20 moderate restantes son dev-tooling** (jest/babel/ts-jest/istanbul + js-yaml vía
@nestjs/swagger): no se empaquetan en la imagen de producción ni están en el camino de un
atacante. Su "fix" según npm sería un **downgrade destructivo** (`jest@30→25`,
`@nestjs/swagger@11→5`), por eso **NO se corre `npm audit fix --force`**. Se resolverán vía
PRs de Dependabot cuando haya versiones upstream sanas.

- `npm audit fix` → https://docs.npmjs.com/cli/v10/commands/npm-audit

---

## Pendientes (no bloqueantes, fuera de esta sesión)

- **20 moderate de dev-tooling** — esperar upstream / PRs de Dependabot; no forzar downgrade.
- **Error tracking** (Sentry o similar) — hoy hay métricas + logs, falta agrupar stack
  traces y alertar sobre 500s nuevos.
- **Índice parcial** del period-sum query — decisión deferida conscientemente
  (ver `docs/period-sum-index-decision.md`).
