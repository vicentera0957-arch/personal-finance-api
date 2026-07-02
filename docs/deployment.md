# Deployment runbook

Guide for deploying the Personal Finance API. Written for a first deploy: it explains
the **what** and the **why**. It is platform-agnostic; platform-specific notes are at the end.

---

## Mental model: Build → Release → Run (12-factor)

```
BUILD    docker build  →  immutable image with dist/ + prod deps
RELEASE  migration:run  →  the DB schema is brought up to date (BEFORE the app starts)
RUN      node dist/main →  the app serves traffic
```

The three phases are deliberately separated. The image is the same in every environment;
the only thing that changes between dev/staging/prod is the **environment variables**.

---

## 1. Packaging (Docker image)

**Multi-stage** Dockerfile (`./Dockerfile`):

- **Build stage:** `npm ci` (all deps) + `nest build` → `dist/`.
- **Runtime stage:** `node:20-alpine`, only `npm ci --omit=dev`, copies `dist/`, non-root
  user, `tini` as PID 1 (forwards SIGTERM so `enableShutdownHooks()` closes cleanly).

```bash
docker build -t personal-finance-api:latest .
```

The `.dockerignore` avoids baking `node_modules`, `.env`, tests and docs into the image.
**Secrets never go into the image** — they are injected via the platform's env.

---

## 2. Release phase (migrations)

`docker-entrypoint.sh` runs `migration:run` (against `dist/data-source.js`) **before**
starting the app. If a migration fails, the container doesn't come up (preferable to
running new code against an old schema).

- Skip migrations in the app container: `RUN_MIGRATIONS=false`
  (use it if you run them in a separate Job/initContainer — the recommended pattern on Kubernetes).
- Manually inside the container: `npm run migration:run:prod`
- Check status: `npm run migration:show:prod`

> `data-source.ts` detects whether it runs compiled (`.js`→`dist/`) or via ts-node (`.ts`→`src/`),
> so the **same** file serves both dev and the prod image.

For zero-downtime schema changes, follow **expand/contract**:
`EXPAND (nullable col) → BACKFILL → MIGRATE (reads the new one) → CONTRACT (drop the old one)`.

---

## 3. Configuration (environment variables)

Validated by Joi at startup (`src/config/env.validation.ts`) — if a required one is missing
or `CORS_ORIGIN='*'` in prod, **the app does not start** (fail-fast).

| Variable | Prod | Note |
|---|---|---|
| `NODE_ENV` | `production` | disables `synchronize`, JSON logs |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | **required, ≥32 chars** | generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | required | managed DB credentials |
| `DB_SSL` | `true` | required by Neon/Supabase/RDS |
| `DB_SSL_REJECT_UNAUTHORIZED` | `true` | `false` only with a self-signed cert |
| `DB_POOL_MAX` | ~10 | tune to the server's connection limit |
| `CORS_ORIGIN` | explicit domains | **not** `'*'` |
| `TRUST_PROXY` | `1` (or number of proxies) | behind a LB, for the real client IP |
| `REDIS_HOST/PORT/PASSWORD` | required | cache + multi-instance throttler |
| `SWAGGER_ENABLED` | `false` optional | if you don't want to expose the spec |

---

## 4. Health checks

- **Liveness** `GET /health` → 200 if the process is alive. If it fails → the orchestrator **restarts**.
- **Readiness** `GET /ready` → 200 if the DB responds, 503 if not. If it fails → the orchestrator
  **stops routing** traffic (without restarting). A transient DB blip doesn't kill the container.

Both are public and live outside the `api/v1` prefix.

---

## 5. Post-deploy verification

```bash
curl -f https://<host>/health    # 200
curl -f https://<host>/ready     # 200 (503 if the DB is down)
# smoke: register and log in
curl -X POST https://<host>/api/v1/auth/register -H 'content-type: application/json' \
  -d '{"email":"a@b.com","password":"Str0ng!pass","name":"Test"}'
```

---

## Platform notes

- **PaaS (Render / Railway / Fly.io):** point the build at the `Dockerfile`. TLS and health checks
  come from the platform (configure `/ready`). Migrations: the entrypoint runs them, or use the
  platform's "release command" with `RUN_MIGRATIONS=false` in the app. Secrets in the panel.
- **Kubernetes:** `Deployment` with `livenessProbe: /health` and `readinessProbe: /ready`;
  migrations in an `initContainer` or `Job` (`RUN_MIGRATIONS=false` in the app pod);
  `Secret`/`ConfigMap` for env; `TRUST_PROXY=1` because of the Ingress.
- **VPS with Docker:** reverse proxy (nginx/Caddy) for TLS, `TRUST_PROXY=1`, `.env` outside the
  repo (`--env-file`), `docker compose` to orchestrate app + Postgres + Redis.

## Known pending items (do not block the first deploy)

- **Observability:** **distributed tracing** and **error tracking (Sentry)** are missing.
  Metrics (Prometheus, `/metrics`) and structured logs (pino) are already in place.
- **CD:** CI builds the image (`docker-build`) but with `push: false` — nobody
  publishes it to a registry or deploys it. Deploys are manual today. A job is missing that
  pushes to GHCR/a registry on push to `main` (or on tag).
- **User deletion:** `DELETE /users/:id` relies on the `ON DELETE CASCADE` from
  `users` to clean up accounts/categories/transactions/budgets/refresh_tokens. The
  direction is right, but the path **has no integration test** that deletes a
  user with a full graph, and `CASCADE` (from user) coexists with `RESTRICT`
  (transactions→accounts, transactions/budgets→categories) in a diamond whose resolution
  order in Postgres is unverified. See note below.

> **Resolved (were pending):** the integration tests live in `test/integration/`
> (no `.bak`) and run in CI (`integration-tests` against real Postgres+Redis). The
> Docker image build is a CI job (`docker-build`). Prometheus metrics
> (`/metrics`) are active.

### Note — user deletion and the CASCADE/RESTRICT diamond

The FK graph (in `InitialSchema`) is:

```
users ──CASCADE──▶ accounts, categories, transactions, budgets, refresh_tokens
transactions ──RESTRICT──▶ accounts
transactions ──RESTRICT──▶ categories
budgets ──RESTRICT──▶ categories
```

The `CASCADE` from `users` is the right design for "delete my account and leave no data
adrift". The cross `RESTRICT` is also right for the normal flow: it prevents
deleting an account/category that still has transactions (→ `AccountInUseException` /
`CategoryInUseException`, 409).

The risk is in the **combination**: when deleting a user, Postgres must cascade both
`accounts` and `transactions`. `RESTRICT` is checked immediately (it is not deferrable,
unlike `NO ACTION`), so if the cascade tries to delete the account **before**
the transactions cascade finishes, the `RESTRICT` can fire and abort the entire
deletion with an FK violation. The behavior depends on the resolution order and
**is not tested**. Before exposing the endpoint to real users:

1. Write an integration test that creates user → account → category → transaction → budget
   and then `DELETE /users/:id`, verifying that everything disappears (or fails cleanly).
2. If the diamond fails: either the cross edges become `NO ACTION` (check deferred to the
   end of the statement — but the DB-level 409 guard is lost), or the deletion is done in
   explicit order at the application layer inside a transaction.
3. Regardless of the outcome: hard-delete is **irreversible**. For financial data,
   DB backups are the real safety net (see the pending backup-runbook item).
