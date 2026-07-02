# Hardening Audit — 2026-04

> **Status 2026-04-26:** The changes documented here are implemented.
> The bugs identified in this audit that are still open (Bug A, Bug B, Bug E) are
> documented with more precision in `CLAUDE.md` ("Active race conditions" section)
> and in `src/modules/transactions/notes.md` and `src/modules/budgets/notes.md`.

Log of the changes that took the app from "solid domain" to "production-shape".
This doc doubles as portfolio material: each section explains **what**, **why** and **how to learn more**.

---

## 1. Hardened bootstrap (`main.ts`)

### What changed
- **Helmet** → HTTP security headers (XSS, clickjacking, MIME-sniffing, HSTS).
- **CORS** configurable via `CORS_ORIGIN`.
- **Global prefix** `api/v1` (excludes `health`).
- **Swagger UI** at `/api/docs` with persisted Bearer auth.
- **Global Pino logger** — JSON in prod, pretty in dev, with a per-request correlation ID.
- **`enableShutdownHooks()`** — Nest shuts down cleanly on SIGTERM (K8s/Docker stop).
- **ValidationPipe** with `transform: true` + `enableImplicitConversion`.

### Why it matters
Each item covers a different class of bug:
- Helmet: the browser blocks XSS attacks when the attacker manages to inject something.
- Prefix: allows versioning (`/api/v2/...`) without breaking existing clients.
- Swagger: living documentation — any controller change is reflected instantly.
- Pino + correlation ID: in prod you can paste an `x-request-id` into Grafana/Datadog and see every log for that request across services.
- ShutdownHooks: without this, during a deploy K8s kills the process forcefully — in-flight transactions, uncommitted queries, unclosed connections.

### Learn more
- Video: "HTTP Security Headers Explained" — Hussein Nasser
- Article: **12factor.net** — XI. Logs: treat as event streams
- Video: Marius Espejo — "NestJS Logging with Pino"

---

## 2. JWT from `ConfigService` + timing-safe login

### What changed
- `JWT_ACCESS_EXPIRES_IN` and `JWT_REFRESH_EXPIRES_IN` come from env vars (previously hardcoded).
- Joi validates that the secrets are ≥ 32 characters.
- `LoginUseCase` runs `bcrypt.compare` even when the user doesn't exist (against a dummy hash) → **timing-attack prevention**.

### Why it matters
- **Config in code** = a redeploy for every change, same value in dev and prod. Config in env = 12-factor compliant.
- **Timing attack:** without the fix, an attacker measures ~5ms (user doesn't exist) vs ~100ms (user exists, wrong password) and enumerates valid emails. With 1M attempts against `/auth/login`, they discover which emails are registered. From there they mount targeted phishing.

### Learn more
- Article: OWASP — "Authentication Cheat Sheet", "Response Discrepancy" section
- Video: LiveOverflow — "Timing Attack" (demo with real code)

---

## 3. Rate limiting (`@nestjs/throttler`)

### What changed
- Global throttler 100 req/min/IP.
- Auth-specific throttler 5 req/min/IP applied to `/auth/*` via `@Throttle({ auth: {...} })`.
- Both configurable via env (`THROTTLE_TTL`, `THROTTLE_LIMIT`, etc).

### Why it matters
Without a rate limit, `/auth/login` is an easy brute-force target — 1000 passwords/second until one hits. At 5/min, an attack would take **years** for a decent password.

### Gap
- The throttler storage is in-memory by default → useless with multiple instances. For prod: `ThrottlerStorageRedis`.
- No separate throttling by user vs IP. Best practice: combine both.

### Learn more
- Article: OWASP — "Brute Force Cheat Sheet"
- Video: Hussein Nasser — "Rate Limiting Algorithms"

---

## 4. Pino structured logging

### What changed
- `nestjs-pino` as the Nest logger.
- Correlation ID (`x-request-id`) — the client can send it or we generate a UUID.
- `redact` to avoid logging `authorization`, `cookie`, `password`, `refreshToken`, `passwordHash`.

### Why it matters
**Console.log doesn't scale.** In prod with multiple instances, you need structured logs that an agent (Loki/Datadog) can parse, index and search by `requestId`, `userId`, `level`. Pino emits JSON to stdout — a 12-factor-compliant pattern.

The `redact` prevents PII leaks — a common mistake is logging `req.body` and with it the raw password.

### Learn more
- Video: "Structured Logging" — Dave Cheney talk (Go, but it applies)
- Article: Pino docs — "Transports" section

---

## 5. Database indexes

### What changed
- `idx_tx_user_date (user_id, transaction_date)` on transactions
- `idx_tx_account_date (account_id, transaction_date)` on transactions
- `idx_tx_user_cat_nature_date (user_id, category_id, nature, transaction_date)` on transactions
- `idx_account_user (user_id)` on accounts
- `uq_users_email (email UNIQUE)` on users

### Why it matters

**Without indexes, every query is a Seq Scan = O(n).** With 100k transactions, a `WHERE user_id = X ORDER BY transaction_date DESC LIMIT 20` without an index reads ALL the rows. With a composite index, Postgres uses the index directly — reads 20 rows, done.

The unique index on `users.email` also closes the "two simultaneous registers with the same email" race — Postgres rejects the second INSERT.

### Concept: prefix rule
An index on `(A, B, C)` works for:
- `WHERE A = ...` — yes
- `WHERE A = ... AND B = ...` — yes
- `WHERE A = ... ORDER BY B` — yes (the ordering follows the index)
- `WHERE B = ...` — no (doesn't use the index — B is not the prefix)

### Gap: partial index pending
The expense-sum query only reads `WHERE nature = 'expense'`. A **partial index** would be ideal:
```sql
CREATE INDEX idx_tx_expense_period ON transactions (user_id, category_id, transaction_date)
WHERE nature = 'expense';
```
Smaller, faster. TypeORM 0.3 doesn't decorate partial indexes — they must be created in raw SQL inside a migration.

### Learn more
- Book: **"Use The Index, Luke!"** — use-the-index-luke.com FREE
- Video: Hussein Nasser — "B-Tree Indexes"

---

## 6. Migrations scaffolding

### What changed
- `src/data-source.ts` — DataSource for the TypeORM CLI.
- Scripts in `package.json`:
  - `npm run migration:generate -- src/database/migrations/MigrationName`
  - `npm run migration:run`
  - `npm run migration:revert`
- `DB_SYNCHRONIZE` env var — never `true` in prod.

### Why it matters
`synchronize: true` is **convenient in dev** (you change the entity, the DB updates at startup) and **dangerous in prod** (it can silently DROP columns).

Migrations = versioned, reversible SQL scripts, applied in CI/CD before the deploy. They enable **zero-downtime deploys** if you follow the expand/contract pattern:

```
1. EXPAND   → add the new nullable column + the app writes to both old and new
2. BACKFILL → a script copies the data
3. MIGRATE  → the app reads only from the new one
4. CONTRACT → drop the old column
```

Between the steps, both versions of the code (old and new) work against both schemas.

### Learn more
- Video: Marius Espejo — "NestJS Database Migrations"
- Article: Martin Fowler — "Evolutionary Database Design"

---

## 7. Swagger decorators on controllers

### What changed
- `@ApiTags('module')` and `@ApiBearerAuth('access-token')` on every controller.
- `@ApiOperation` + `@ApiResponse` on the critical `/auth` endpoints.

### Why it matters
`/api/docs` is now a browsable contract. A recruiter, frontend dev or QA can:
- See all endpoints grouped.
- Execute requests from the browser with "Try it out".
- Authenticate with Authorize → the token persists across requests.

For a portfolio: opening `/api/docs` communicates professionalism in 3 seconds.

---

## 8. Per-module notes

Each module has a `notes.md` with:
- The domain concept (why the module exists).
- Invariant rules (R1…R8).
- Design decisions + why.
- Known gaps and what's left to implement.
- Resources to learn what's missing.

Files:
- `src/modules/auth/notes.md`
- `src/modules/users/notes.md`
- `src/modules/accounts/notes.md`
- `src/modules/categories/notes.md`
- `src/modules/budgets/notes.md`
- `src/modules/transactions/notes.md`

---

## What's next (ordered by impact/learning value)

| # | Topic | Requires |
|---|------|----------|
| 1 | Refresh token rotation + revocation | Migration + new port |
| 2 | OAuth Google + GitHub | Passport strategies + Google/GitHub OAuth apps |
| 3 | Redis cache-aside for `GetCategoriesByUserId` and `GetBudgetByUserCategoryPeriod` | Redis (docker-compose) + `@nestjs/cache-manager` |
| 4 | BullMQ — worker for verification emails | Redis + `@nestjs/bullmq` |
| 5 | `/reports/monthly` endpoint with CTEs + window functions | Code only |
| 6 | Integration tests with Postgres testcontainers | `testcontainers` npm |
| 7 | CI with GitHub Actions (lint + test + build + docker push) | GitHub account |
| 8 | Multi-stage Dockerfile | Code only |

---

## Stats

- **Tests:** 560 passed / 560 total
- **Build:** clean
- **New packages:** helmet, @nestjs/swagger, swagger-ui-express, @nestjs/throttler, nestjs-pino, pino, pino-http, pino-pretty, dotenv
- **Files edited/created:** ~18
