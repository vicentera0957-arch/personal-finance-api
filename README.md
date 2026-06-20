# Personal Finance API

> A personal-finance REST API built to get the hard part right: **money that stays
> correct under concurrent writes.** NestJS + PostgreSQL + Redis, strict DDD / Clean
> architecture, with every multi-aggregate invariant protected by a Unit of Work and
> pessimistic row locks.

<p>
  <img alt="NestJS" src="https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white">
  <img alt="Redis" src="https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-multi--stage-2496ED?logo=docker&logoColor=white">
  <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green.svg">
</p>

<!-- TODO: once the repo is public, add the live CI badge:
<img alt="CI" src="https://github.com/<your-username>/personal-finance-api/actions/workflows/ci.yml/badge.svg"> -->

## See it running

- **Live API (Swagger / OpenAPI):** <!-- TODO: paste your deployed Swagger URL, e.g. https://your-app.onrender.com/api/docs -->
- **Demo:** _GIF coming soon_ <!-- TODO: record docs/assets/demo.gif (register → login → create account → budget → transaction → 422 when over limit) and embed it here with ![demo](docs/assets/demo.gif) -->

---

## The problem (and why it isn't trivial)

A finance backend is easy to build and hard to make **correct**. The interesting bugs
aren't CRUD — they're concurrency: two requests spending against the same budget at the
same time, a balance updated twice, a budget deleted while a transaction lands in its
period. This project treats those as the core engineering problem and closes them at the
database layer, not by hoping requests don't overlap.

## Engineering decisions

The decisions worth reviewing — each links to the code and, where written, an ADR.

### 🔒 Concurrency-safe money — Unit of Work + pessimistic locks

Multi-aggregate, money-touching invariants (account balance, budget limit, period
spend) run inside a **request-scoped Unit of Work**: one `QueryRunner`, one PostgreSQL
transaction. Scoped repositories take `SELECT ... FOR UPDATE` on the rows that gate each
invariant, and the **budget row acts as a logical mutex** for "Σ period expenses ≤
limit". A catalogue of races (write skew, lost update, TOCTOU) is documented as
**reproduced and closed**.
→ [ADR-0002](docs/adr/0002-unit-of-work-pessimistic-locks.md) · [concurrency model](docs/concurrency-model.md) · [`create-transaction.use-case.ts`](src/modules/transactions/application/use-cases/create-transaction.use-case.ts)

### 🧱 Strict DDD / Clean architecture

Three layers per module with dependencies pointing inward; the domain has **zero**
NestJS/TypeORM/HTTP imports. Ports are `abstract class` so they serve as both type and
DI token. Rich entities with private constructors and `create()` / `reconstitute()`
factories; immutable, self-validating value objects.
→ [architecture](docs/architecture.md) · [ADR-0001](docs/adr/0001-ports-as-abstract-classes.md)

### 🔁 Refresh-token rotation with replay detection

Refresh tokens are persisted as `sha256(token)` (never plaintext), grouped into a
**family** per login. Every refresh rotates the token; a replayed token revokes the
**entire family** atomically. Login is timing-safe (constant-time even for unknown
emails) to prevent enumeration.
→ [ADR-0004](docs/adr/0004-refresh-token-rotation.md)

### 🧾 Immutable, single-entry transactions

Transactions are immutable accounting records — no in-place update; corrections are
delete + recreate. The model is **single-entry** by design for V1 (documented honestly,
with trade-offs, not dressed up as a ledger it isn't).
→ [ADR-0005](docs/adr/0005-single-entry-immutable-transactions.md)

### 🛡️ Defense in depth & production hardening

Uniqueness enforced in three layers (DB constraint + `23505` catch → domain exception +
application pre-check). Helmet, env validation with Joi (fail-fast on missing prod
secrets), Redis-backed per-IP throttling, Prometheus metrics, structured logging,
liveness/readiness probes, multi-stage non-root Docker image, migrations run as a
release phase.
→ [deployment runbook](docs/deployment.md)

## Architecture at a glance

Dependencies flow one way; the `accounts ↔ transactions` cycle is resolved with a
"port owned by consumer" pattern. Full diagrams and request flow in
[docs/architecture.md](docs/architecture.md).

```mermaid
graph TD
    auth[auth] --> users[users]
    transactions[transactions] --> budgets[budgets]
    budgets --> categories[categories]
    transactions --> accounts[accounts]
    accounts -. forwardRef .-> transactions
    transactions -. IExpenseChecker / IAccountUnitOfWork .-> accounts
```

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node 20, NestJS 11, TypeScript 5 |
| Persistence | PostgreSQL 15, TypeORM 0.3 (migrations) |
| Cache / rate-limit | Redis 7 (cache + throttler storage) |
| Auth | JWT access + rotating refresh, bcrypt, Passport |
| Validation | class-validator (HTTP), Joi (env) |
| Observability | Prometheus (`prom-client`), pino, Terminus health checks |
| Packaging | Docker (multi-stage, non-root, tini) |
| CI | GitHub Actions (lint, build, unit, integration, migration smoke, docker build, security audit) |

## Run it locally

**Requirements:** Docker Desktop, Node 20+

```bash
# 1. Environment
cp .env.example .env
# Generate the two JWT secrets (the app won't boot without them):
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
# Note: set DB_PORT=5433 in .env (the compose Postgres is published on 5433, not 5432).

# 2. Infrastructure (Postgres :5433 · Redis :6379 · pgAdmin :5051)
docker compose up -d

# 3. Install, migrate, run
npm install
npm run migration:run      # schema via migrations (synchronize is off by default)
npm run start:dev
```

- API → `http://localhost:3000/api/v1`
- Swagger → `http://localhost:3000/api/docs`

## Testing

```bash
npm test                   # unit (domain + use cases), no DB
npm run test:integration   # integration against a real Postgres
npm run test:cov           # coverage
```

The suite includes a dedicated **concurrency** integration spec that drives the race
conditions above against a real database. Coverage thresholds are enforced in CI —
the domain layer is gated at **95% lines / 90% functions**.

## Roadmap

<!-- TODO: fill in. Left intentionally empty for now. -->

## Documentation

| You want… | Read |
| --- | --- |
| The architecture & request flow | [docs/architecture.md](docs/architecture.md) |
| Why decisions were made | [docs/adr/](docs/adr/) |
| The concurrency model & lock map | [docs/concurrency-model.md](docs/concurrency-model.md) |
| How to deploy | [docs/deployment.md](docs/deployment.md) |
## License

[MIT](LICENSE) © 2026 Vicente Cristobal Rivas Avello
