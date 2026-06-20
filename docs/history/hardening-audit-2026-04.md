# Hardening Audit — 2026-04

> **Estado 2026-04-26:** Los cambios documentados aquí están implementados.
> Los bugs identificados en este audit que aún están abiertos (Bug A, Bug B, Bug E) están
> documentados con mayor precisión en `CLAUDE.md` (sección "Active race conditions")
> y en `src/modules/transactions/notes.md` y `src/modules/budgets/notes.md`.

Registro de los cambios que llevaron la app de "dominio sólido" a "production-shape".
Este doc sirve como portfolio: cada sección explica **qué**, **por qué** y **cómo aprender más**.

---

## 1. Bootstrap endurecido (`main.ts`)

### Qué cambió
- **Helmet** → cabeceras HTTP de seguridad (XSS, clickjacking, MIME-sniffing, HSTS).
- **CORS** configurable por `CORS_ORIGIN`.
- **Global prefix** `api/v1` (excluye `health`).
- **Swagger UI** en `/api/docs` con Bearer auth persistida.
- **Pino logger** global — JSON en prod, pretty en dev, con correlation ID por request.
- **`enableShutdownHooks()`** — Nest cierra limpio en SIGTERM (K8s/Docker stop).
- **ValidationPipe** con `transform: true` + `enableImplicitConversion`.

### Por qué importa
Cada item cubre una clase de bug distinta:
- Helmet: navegador bloquea ataques XSS cuando el attacker logra inyectar algo.
- Prefix: permite versionar (`/api/v2/...`) sin romper clientes existentes.
- Swagger: documentación viva — cualquier cambio en controllers se refleja al instante.
- Pino + correlation ID: en prod podés pegar un `x-request-id` en Grafana/Datadog y ver todos los logs de ese request entre servicios.
- ShutdownHooks: sin esto, durante un deploy K8s mata el proceso a la fuerza — transacciones en curso, queries sin commit, conexiones sin cerrar.

### Aprender más
- 🎥 "HTTP Security Headers Explained" — Hussein Nasser
- 📄 **12factor.net** — XI. Logs: treat as event streams
- 🎥 Marius Espejo — "NestJS Logging with Pino"

---

## 2. JWT desde `ConfigService` + timing-safe login

### Qué cambió
- `JWT_ACCESS_EXPIRES_IN` y `JWT_REFRESH_EXPIRES_IN` salen de env vars (antes hardcoded).
- Joi valida que los secrets tengan ≥ 32 caracteres.
- `LoginUseCase` ejecuta `bcrypt.compare` incluso cuando el user no existe (contra hash dummy) → **timing-attack prevention**.

### Por qué importa
- **Config en código** = redeploy cada cambio, mismo valor en dev y prod. Config en env = 12-factor compliant.
- **Timing attack:** sin el fix, un atacante mide ~5ms (user no existe) vs ~100ms (user existe, password malo) y enumera emails válidos. Con 1M intentos a `/auth/login`, descubre qué emails están registrados. Desde ahí monta phishing targeted.

### Aprender más
- 📄 OWASP — "Authentication Cheat Sheet" sección "Response Discrepancy"
- 🎥 LiveOverflow — "Timing Attack" (demo con código real)

---

## 3. Rate limiting (`@nestjs/throttler`)

### Qué cambió
- Throttler global 100 req/min/IP.
- Throttler específico `auth` 5 req/min/IP aplicado a `/auth/*` vía `@Throttle({ auth: {...} })`.
- Ambos configurables por env (`THROTTLE_TTL`, `THROTTLE_LIMIT`, etc).

### Por qué importa
Sin rate limit, `/auth/login` es blanco fácil de fuerza bruta — 1000 passwords/segundo hasta encontrar uno. Con 5/min, un ataque tardaría **años** para una password decente.

### Gap
- Storage de throttler es in-memory por defecto → no sirve con múltiples instancias. Para prod: `ThrottlerStorageRedis`.
- No hay throttler diferenciado por user vs IP. Mejor práctica: combinar ambos.

### Aprender más
- 📄 OWASP — "Brute Force Cheat Sheet"
- 🎥 Hussein Nasser — "Rate Limiting Algorithms"

---

## 4. Pino structured logging

### Qué cambió
- `nestjs-pino` como logger de Nest.
- Correlation ID (`x-request-id`) — cliente puede mandarlo o generamos UUID.
- `redact` para no logear `authorization`, `cookie`, `password`, `refreshToken`, `passwordHash`.

### Por qué importa
**Console.log no escala.** En prod con múltiples instancias, necesitás logs estructurados que un agente (Loki/Datadog) parsee, indexe y permita buscar por `requestId`, `userId`, `level`. Pino emite JSON a stdout — pattern 12-factor compliant.

El `redact` previene PII leaks — un error común es logear `req.body` y con eso también el password crudo.

### Aprender más
- 🎥 "Structured Logging" — Dave Cheney talk (Go pero aplica)
- 📄 Pino docs — sección "Transports"

---

## 5. Índices de base de datos

### Qué cambió
- `idx_tx_user_date (user_id, transaction_date)` en transactions
- `idx_tx_account_date (account_id, transaction_date)` en transactions
- `idx_tx_user_cat_nature_date (user_id, category_id, nature, transaction_date)` en transactions
- `idx_account_user (user_id)` en accounts
- `uq_users_email (email UNIQUE)` en users

### Por qué importa

**Sin índices, todo query es Seq Scan = O(n).** Con 100k transacciones, un `WHERE user_id = X ORDER BY transaction_date DESC LIMIT 20` sin índice lee TODAS las filas. Con índice compuesto, Postgres usa el índice directamente — lee 20 filas, done.

El de `users.email` unique además cierra la race de "dos registers simultáneos con mismo email" — Postgres rechaza el segundo INSERT.

### Concepto: prefix rule
Un índice en `(A, B, C)` sirve para:
- `WHERE A = ...` ✅
- `WHERE A = ... AND B = ...` ✅
- `WHERE A = ... ORDER BY B` ✅ (orden sigue el índice)
- `WHERE B = ...` ❌ (no usa el índice — B no es el prefijo)

### Gap: índice parcial pendiente
El query de suma de expenses sólo lee `WHERE nature = 'expense'`. Un **partial index** sería ideal:
```sql
CREATE INDEX idx_tx_expense_period ON transactions (user_id, category_id, transaction_date)
WHERE nature = 'expense';
```
Más chico, más rápido. TypeORM 0.3 no decora partial indexes — hay que crearlos en raw SQL dentro de una migration.

### Aprender más
- 📚 **"Use The Index, Luke!"** — use-the-index-luke.com GRATIS
- 🎥 Hussein Nasser — "B-Tree Indexes"

---

## 6. Migrations scaffolding

### Qué cambió
- `src/data-source.ts` — DataSource para la CLI de TypeORM.
- Scripts en `package.json`:
  - `npm run migration:generate -- src/database/migrations/NombreDeMigracion`
  - `npm run migration:run`
  - `npm run migration:revert`
- `DB_SYNCHRONIZE` env var — nunca `true` en prod.

### Por qué importa
`synchronize: true` es **cómodo en dev** (cambiás la entity, la DB se actualiza al arrancar) y **peligroso en prod** (puede DROP columns silenciosamente).

Migrations = scripts SQL versionados, reversibles, aplicados en CI/CD antes del deploy. Permite **zero-downtime deploys** si seguís el patrón expand/contract:

```
1. EXPAND  → agregás columna nueva nullable + app escribe en vieja y nueva
2. BACKFILL → script copia datos
3. MIGRATE → app lee solo de la nueva
4. CONTRACT → drop columna vieja
```

Entre los pasos, ambas versiones del código (vieja y nueva) funcionan contra ambos schemas.

### Aprender más
- 🎥 Marius Espejo — "NestJS Database Migrations"
- 📄 Martin Fowler — "Evolutionary Database Design"

---

## 7. Swagger decorators en controllers

### Qué cambió
- `@ApiTags('modulo')` y `@ApiBearerAuth('access-token')` en todos los controllers.
- `@ApiOperation` + `@ApiResponse` en los endpoints críticos de `/auth`.

### Por qué importa
`/api/docs` ahora es un contrato navegable. Recruiter, frontend dev o QA pueden:
- Ver todos los endpoints agrupados.
- Ejecutar requests desde el browser con "Try it out".
- Autenticarse con Authorize → el token persiste entre requests.

Para un portfolio: abrir `/api/docs` comunica profesionalismo en 3 segundos.

---

## 8. Notes por módulo

Cada módulo tiene un `notes.md` con:
- Concepto de dominio (por qué existe el módulo).
- Reglas invariantes (R1…R8).
- Decisiones de diseño + por qué.
- Gaps conocidos y qué falta implementar.
- Recursos para aprender lo que falta.

Archivos:
- `src/modules/auth/notes.md`
- `src/modules/users/notes.md`
- `src/modules/accounts/notes.md`
- `src/modules/categories/notes.md`
- `src/modules/budgets/notes.md`
- `src/modules/transactions/notes.md`

---

## Lo que sigue (ordenado por impacto/learning value)

| # | Tema | Requiere |
|---|------|----------|
| 1 | Refresh token rotation + revocación | Migration + nuevo port |
| 2 | OAuth Google + GitHub | Passport strategies + Google/GitHub OAuth apps |
| 3 | Redis cache-aside para `GetCategoriesByUserId` y `GetBudgetByUserCategoryPeriod` | Redis (docker-compose) + `@nestjs/cache-manager` |
| 4 | BullMQ — worker para emails de verificación | Redis + `@nestjs/bullmq` |
| 5 | Endpoint `/reports/monthly` con CTEs + window functions | Solo código |
| 6 | Integration tests con testcontainers Postgres | `testcontainers` npm |
| 7 | CI con GitHub Actions (lint + test + build + docker push) | Cuenta GitHub |
| 8 | Dockerfile multi-stage | Solo código |

---

## Stats

- **Tests:** 560 passed / 560 total ✅
- **Build:** clean ✅
- **Paquetes nuevos:** helmet, @nestjs/swagger, swagger-ui-express, @nestjs/throttler, nestjs-pino, pino, pino-http, pino-pretty, dotenv
- **Archivos editados/creados:** ~18
