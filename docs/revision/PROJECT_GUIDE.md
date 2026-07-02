# Project Guide — Personal Finance API

> **Archived / superseded.** This legacy master guide was replaced by
> [`architecture.md`](../architecture.md), the [docs index](../README.md) and the
> [ADRs](../adr/). It is kept as a reference; parts of the content may be outdated.

Master document to **understand every part of the project**. It is the entry point:
start here and follow the links depending on what you need. Written both for you in 6 months
and for someone arriving for the first time (or a recruiter reviewing the repo).

> **Why this doc exists:** `CLAUDE.md` (the exhaustive reference for AI) was
> gitignored, so **this** was the repo's versioned architecture document.

---

## 1. What this is

A personal finance REST API: a user registers **accounts**, defines **categories**
(income/expense), sets monthly **budgets** per category, and records **transactions**
that move their account balances while respecting budget limits.

- **Stack:** NestJS 11 · TypeORM · PostgreSQL 15 · JWT (access + refresh with rotation) · Redis (cache + rate-limit).
- **Style:** strict Domain-Driven Design, Ports & Adapters, Unit of Work with pessimistic locks.
- **Status:** mature domain and security; ready for a first deploy (see §7).

Reference diagrams:
- Diagrams (Mermaid, up to date) in [`architecture.md`](../architecture.md). The old SVG/PNGs are in this same folder (`revision/`).
- [Data model (PDF)](../database/Finanzas%20V1.pdf)
- [Business rules (PDF)](../domain/Reglas%20de%20negocio.docx.pdf)

---

## 2. Documentation map

| You need… | Read |
|---|---|
| Start the project locally | [`README.md`](../../README.md) |
| Understand the full architecture (this doc) | **PROJECT_GUIDE.md** |
| Exhaustive reference (patterns, tables, anti-patterns) | `CLAUDE.md` |
| Living detail of a module | `src/modules/<m>/notes.md` |
| Why the cache uses composition and not inheritance | [`src/shared/domain/cache-decision.md`](../../src/shared/domain/cache-decision.md) |
| Why the UoW uses port inheritance | [`src/shared/domain/uow-decision.md`](../../src/shared/domain/uow-decision.md) |
| Architecture + diagrams (Mermaid) | [`docs/architecture.md`](../architecture.md) |
| Design decisions (ADRs) | [`docs/adr/`](../adr/) |
| Testing (unit + integration, test doubles) | [`docs/testing.md`](../testing.md) |
| Observability (logs, metrics, traces) | [`docs/observability.md`](../observability.md) |
| How to deploy (build/release/run, env vars, health) | [`docs/deployment.md`](../deployment.md) |
| Hardening history (journal, Apr 2026) | [`docs/history/hardening-audit-2026-04.md`](../history/hardening-audit-2026-04.md) |
| How the race conditions were closed (journal, May 2026) | [`docs/history/race-conditions-fix-2026-05.md`](../history/race-conditions-fix-2026-05.md) |
| Production-readiness changes (journal, Jun 2026) | [`docs/history/production-readiness-2026-06-16.md`](../history/production-readiness-2026-06-16.md) |

---

## 3. Three-layer architecture

Every module (`auth`, `users`, `accounts`, `categories`, `budgets`, `transactions`) has
the same skeleton:

```
src/modules/<module>/
  domain/           # PURE: no NestJS, no TypeORM, no HTTP
    entities/         # rich entities, private constructor, create()/reconstitute() factories
    value-objects/    # immutable, self-validating
    exceptions/       # Error subclasses (NOT HttpException)
    repository/       # ports (abstract class)
  application/
    use-cases/        # one class per use case, one execute()
    schedulers/       # @Cron (auth only today)
  infrastructure/
    persistence/      # ORM entity, mapper, repo impl, UoW impl
    http/             # controllers + DTOs (class-validator)
    adapters/         # bcrypt, JWT, etc.
```

**The golden rule:** dependencies point inward. `domain` knows nobody;
`application` knows `domain`; `infrastructure` knows both. The domain never imports
TypeORM or HTTP.

### Why the ports are `abstract class` and not `interface`

NestJS needs a **runtime token** to inject. A TypeScript `interface` is erased
at compile time → it can't be a token. That is why the ports (repositories, UoW, caches) are
`abstract class`: they work as a type *and* as a DI token. Changing them to `interface` breaks the
injection graph. (Expanded detail in `cache-decision.md`.)

### Module hierarchy and dependencies

```
auth → users → (accounts, categories, budgets, transactions)
```

- `auth` uses `users` (login/register call users' use cases).
- Within the finance modules: **transactions → budgets → categories → accounts**.
- There is an `accounts ↔ transactions` cycle resolved with `forwardRef()` + the
  **"port owned by consumer"** pattern: when A needs to ask B something but B already depends on A,
  the *port* is defined in A's domain and the *implementation* in B's infrastructure
  (e.g. `IExpenseChecker`, `IAccountUnitOfWork`).

---

## 4. Patterns that don't change

| Pattern | What it is | Why |
|---|---|---|
| **Factory methods** | `Entity.create(props)` (new) vs `Entity.reconstitute(props)` (from DB) | `create` generates timestamps and validates; `reconstitute` preserves timestamps and doesn't re-validate. Mappers **always** use `reconstitute`. |
| **Value Objects** | Immutable, validate in `create`, not in `reconstitute` | Once created, it is valid. An invalid VO is never persisted. |
| **Domain exceptions** | The domain throws `BudgetNotFoundException extends Error`, not `NotFoundException` | The domain knows nothing about HTTP. The **controller** translates with `instanceof` → HTTP code. |
| **`userId` from `@CurrentUser()`** | The actor comes from the JWT, never from the body/URL | Security rule: a body with `userId:'X'` is an attempt to act as X. Only the JWT is trusted. |
| **Defense in depth** | DB unique + `catch 23505` → domain exception + pre-check in the use case | Three layers for every uniqueness rule. |

---

## 5. Concurrency: Unit of Work + pessimistic locks

The technical heart of the project. Every invariant that crosses multiple aggregates (account balance,
budget limit, period expense sum) is protected with a **DB transaction +
`SELECT ... FOR UPDATE`**.

**Core idea:** every HTTP request that mutates several aggregates opens an `IUnitOfWork`
(request-scoped) → a single `QueryRunner` → a single PostgreSQL transaction. The "scoped"
repositories the UoW hands out share that `EntityManager`, so the pessimistic locks are
effective throughout the whole read→validate→write sequence.

```
Use case → uow.begin() → scoped repos (FOR UPDATE) → domain → uow.commit()
                                                             ↘ catch → uow.rollback()
                                                             ↘ finally → uow.release()
```

- A single class (`TypeOrmUnitOfWorkImpl`, in `transactions/infrastructure/`) satisfies three
  module ports (`ITransactionUnitOfWork`, `IBudgetUnitOfWork`, `IAccountUnitOfWork`)
  via `useExisting` → the same instance and transaction per request.
- `auth` has its own UoW (`AuthUnitOfWorkImpl`) because its boundary (refresh-token
  rotation) shares no invariant with the financial aggregates.
- The **budget row works as a logical mutex** for the "Σ period expenses ≤ limit" invariant:
  every flow that touches that invariant locks that row first.

**Go deeper:** [`uow-decision.md`](../../src/shared/domain/uow-decision.md) (port hierarchy),
[`history/race-conditions-fix-2026-05.md`](../history/race-conditions-fix-2026-05.md) (TOCTOU diagrams of
the closed races), [`concurrency-model.md`](../concurrency-model.md) (full model) and the
"Concurrency" section of `CLAUDE.md` (full lock table).

---

## 6. Authentication

- **Access token** (15 min, `JWT_SECRET`) stateless; **refresh token** (7 days,
  `JWT_REFRESH_SECRET`) persisted in `refresh_tokens` (only `sha256(token)`, never the plaintext).
- **Rotation with replay detection:** each `/auth/refresh` invalidates the old token and issues a
  new one in the same *family*. If an already-rotated token arrives → the **entire family** is revoked
  (`UPDATE … WHERE family_id = $1`) and it is rejected. Real sign-out via `/auth/logout`.
- **Timing-safe login:** runs `bcrypt.compare` even when the email doesn't exist (against a dummy
  hash) and returns a generic error → doesn't leak which emails are registered.
- **Global guard** `JwtAuthGuard` (deny-by-default); `@Public()` opens routes (`/auth/*`,
  `/health`, `/ready`). Strict rate limit (5/min) on `/auth/*`.

Living reference: `src/modules/auth/notes.md`.

---

## 7. Deploy

The packaging and the platform contract are implemented; see the full runbook in
[`docs/deployment.md`](../deployment.md). Summary of the **Build → Release → Run** model:

- **Build:** multi-stage `Dockerfile` → minimal image with `dist/` + prod deps (non-root user, `tini`).
- **Release:** `docker-entrypoint.sh` runs `migration:run` (against `dist/data-source.js`) before starting.
- **Run:** `node dist/main.js`, with `enableShutdownHooks()` for clean shutdown on SIGTERM.
- **Config:** validated by Joi at startup; in prod the app **doesn't start** if a secret is missing or if `CORS_ORIGIN='*'`.
- **Health:** `/health` (liveness) and `/ready` (readiness, validates the DB with Terminus).

---

## 8. Testing

```bash
npm test                  # unit (domain + use cases), no DB
npm run test:integration  # integration with real Postgres (test/.env.test)
npm run test:cov          # coverage
```

- **Unit:** ~595 tests, domain and use cases covered with in-memory fakes.
- **Integration:** **active** suite against real Postgres (auth, users, accounts, categories, budgets,
  transactions and a dedicated **concurrency** spec) via `npm run test:integration`. Details in
  [`testing.md`](../testing.md).
- CI (`.github/workflows/ci.yml`): 7 jobs — `lint`, `build`, unit (with coverage), integration,
  *migration smoke*, *docker build* and *security audit*.

---

## 9. Status and what's missing

**Solid today:** domain, concurrency (races closed), auth with rotation, migrations
consolidated into a single `InitialSchema`, hardened bootstrap, deploy packaging verified E2E,
active integration suite, Prometheus metrics + health/readiness.

**Pending (doesn't block the first deploy):**
1. Link the live URL + Swagger in the README (the deploy is already done).
2. Observability: **tracing** (OpenTelemetry) + **error tracking** (Sentry) — metrics and logs are done.
3. Partial index `WHERE nature='expense'` (optimization; careful with the entity↔DB drift).

---

## 10. Commands at a glance

```bash
npm run start:dev          # development with hot reload
npm run build              # compiles to dist/
npm run lint               # eslint
npm test                   # unit tests
npm run migration:run      # applies migrations (dev, ts-node)
npm run migration:generate # generates a migration from the entity diff
docker compose up -d       # Postgres (5433) + Redis + pgAdmin (5051)
docker build -t personal-finance-api .   # production image
```
