# Personal Finance API — CLAUDE.md

Source of truth for collaborators (humans and AI). Mixes **reference** (tables, lists) and **mental model** (the _why_). When the code and this doc disagree, the code wins — but open a PR to fix the doc in the same change.

---

## Stack & commands

- **Runtime:** NestJS 11 + TypeORM + PostgreSQL 15 (alpine in dev).
- **Auth:** JWT access + refresh, refresh persisted with rotation + replay detection.
- **Scheduling:** `@nestjs/schedule` (refresh-token cleanup cron).
- **Validation:** `class-validator` DTOs at the HTTP boundary, `joi` for env vars.
- **Local DB:** `docker-compose` exposes Postgres on port **5433** (not 5432) and pgAdmin on 5051. Use `DB_PORT=5433` in `.env`.
- **Schema in dev:** `synchronize` is opt-in via `DB_SYNCHRONIZE=true` AND `NODE_ENV !== 'production'`. Default is `false` — migrations are the path.

Scripts you'll actually use:

```
npm run start:dev          # nest start --watch
npm test                   # all unit tests
npm run test:integration   # integration suite (uses test/.env.test)
npm run migration:run      # apply pending migrations
npm run migration:generate # generate from current entity diff
npm run lint
```

---

## Architecture

Each module has the same three-layer skeleton:

```
src/modules/<module>/
  domain/                   # Pure: no NestJS, no TypeORM, no HTTP
    entities/               # Rich entities, private constructors
    value-objects/          # Immutable, self-validating
    exceptions/             # Plain Error subclasses
    repository/             # Port interfaces (abstract classes)
    I<Module>UnitOfWork.ts  # If module needs transactional boundary
  application/
    use-cases/              # One class per use case, single execute()
    schedulers/             # @Cron jobs (auth only today)
  infrastructure/
    persistence/            # ORM entity, mapper, repo impl, UoW impl
    http/
      dto/                  # class-validator request/response DTOs
      <name>-controller/    # NestJS controller — maps domain → HTTP
    adapters/               # External-system adapters (bcrypt, JWT, …)
```

### Why DDD with abstract-class ports

NestJS DI needs a runtime token. TypeScript `interface` is erased at compile time, so it can't be a token. **Repository ports and UoW ports are `abstract class`** — they double as types and as injection tokens. Concrete implementations are bound via `{ provide: IFooRepository, useClass: FooRepositoryImpl }`.

This is non-negotiable: switching ports to `interface` breaks the DI graph.

### Module hierarchy

```
auth → users → (accounts, categories, budgets, transactions)
```

- `auth` sits above `users` because login/register call `GetUserByEmailUseCase` and `CreateUserUseCase`.
- Domain modules (accounts, categories, budgets, transactions) are peers but with one direction of dependency: **transactions → budgets → categories → accounts**, plus the cycle resolved via the "port owned by consumer" pattern (see below).

---

## Patterns that don't change

These are stable rules. If you find yourself bending them, stop and write a new section in this doc justifying the exception.

### 1. Factory methods on domain entities

Private constructor + two static factories:

- `Entity.create(props)` — for new entities. Generates `createdAt` / `updatedAt`.
- `Entity.reconstitute(props)` — for rebuilding from persistence. Preserves the original timestamps.

Mappers always call `reconstitute()`. Calling `create()` in a mapper would re-run validation against already-persisted data and could break in runtime if a validation rule tightens.

### 2. Value objects

Immutable, self-validating in `create()`, no validation in `reconstitute()`. Always use the entity's getters; never reach into `props`.

### 3. Domain exceptions, not HTTP exceptions

Domain throws `BudgetNotFoundException extends Error`, not `NotFoundException`. The controller does `instanceof` checks and translates. **Domain has zero knowledge of HTTP.**

### 4. `userId` from `@CurrentUser()`, never from body or URL

The JWT strategy populates `req.user.userId`. Controllers pass it down to use cases. Body and URL never carry the actor's id — only target ids (`/accounts/:id`, etc.).

This is a security rule, not a style preference. A request body that says `userId: 'X'` is a request to act on behalf of X. Trust the JWT, nothing else.

### 5. The "port owned by consumer" pattern

When module A needs to ask module B about something but module B already imports from A, define the port in **A's** domain and the implementation in **B's** infrastructure.

Example: `IExpenseChecker` lives in `budgets/domain/repository/expense-checker.port.ts`. It is implemented by `ScopedExpenseChecker` inside `transactions/infrastructure/persistence/unit-of-work.impl.ts` (private to the UoW), reached only via `getScopedExpenseChecker()`. This keeps the dependency direction clean even when `forwardRef()` is needed for the NestJS DI graph. (There is no standalone global binding — the only legitimate callers, `DeleteBudget` / `UpdateBudgetLimit`, run inside the UoW.)

---

## Concurrency: Unit of Work + pessimistic locks

### The model

The system has **two** concrete UoW implementations, satisfying **four** module-specific ports:

| Port                     | Owner                 | Used by                                  | Implemented by          |
| ------------------------ | --------------------- | ---------------------------------------- | ----------------------- |
| `IUnitOfWork`            | `shared/domain`       | (base — lifecycle only)                  | both impls              |
| `ITransactionUnitOfWork` | `transactions/domain` | `CreateTransaction`, `DeleteTransaction` | `TypeOrmUnitOfWorkImpl` |
| `IBudgetUnitOfWork`      | `budgets/domain`      | `UpdateBudgetLimit`, `DeleteBudget`      | `TypeOrmUnitOfWorkImpl` |
| `IAccountUnitOfWork`     | `accounts/domain`     | `Archive`, `Unarchive`, `Rename`         | `TypeOrmUnitOfWorkImpl` |
| `IAuthUnitOfWork`        | `auth/domain`         | `RefreshToken`                           | `AuthUnitOfWorkImpl`    |

**`TypeOrmUnitOfWorkImpl`** lives in `transactions/infrastructure/`. One class implements three module ports. NestJS wires them via `useExisting`, so all three resolve to the same request-scoped instance — and therefore the same `QueryRunner` / DB transaction.

```ts
{ provide: TypeOrmUnitOfWorkImpl,  useClass: TypeOrmUnitOfWorkImpl, scope: Scope.REQUEST }
{ provide: ITransactionUnitOfWork, useExisting: TypeOrmUnitOfWorkImpl }
{ provide: IBudgetUnitOfWork,      useExisting: TypeOrmUnitOfWorkImpl }
{ provide: IAccountUnitOfWork,     useExisting: TypeOrmUnitOfWorkImpl }
```

### Why the impl lives in `transactions/`

Every multi-aggregate invariant in this domain is anchored to a `Transaction` mutation: balance update, budget-limit enforcement, period-spent sums. The races that need `FOR UPDATE` all involve the transactions module. The other modules' invariants (uniqueness of email, of budget per period, etc.) are enforced by DB constraints + `catch 23505`, not by application-level locks. This makes `transactions` the natural home for the impl. The ports in each consumer's domain express ownership of the _contract_; the impl in transactions expresses ownership of the _driving need_.

### Why `IAuthUnitOfWork` is separate

Auth's transactional boundary is independent: refresh-token rotation only touches `refresh_tokens`. There is no shared invariant between auth and the financial aggregates. Mixing them into one impl would couple two unrelated bounded contexts and force `AuthModule` to depend on `transactions` at the DI layer. So `AuthUnitOfWorkImpl` lives in `auth/infrastructure/`, with its own `ScopedRefreshTokenRepository`.

### Scoped resources

The transactional UoW exposes four scoped resources, all sharing the same `EntityManager`(typeorm):

- `getTransactionRepository()` → `ScopedTransactionRepository`
- `getAccountRepository()` → `ScopedAccountRepository`
- `getBudgetRepository()` → `ScopedBudgetRepository`
- `getScopedExpenseChecker()` → `ScopedExpenseChecker`

The auth UoW exposes:

- `getRefreshTokenRepository()` → `ScopedRefreshTokenRepository`

These classes are **private to the impl file**. The only way to obtain them is through the UoW. They take pessimistic locks aggressively because, by construction, they only ever execute inside an active `QueryRunner` — reading by id inside a transaction implies intent to mutate.

### Locking & serialization map

Row-based reads (`findById`, `findByTokenHashWithLock`) take `FOR UPDATE`. Aggregate reads (`SUM`/`COUNT`) **cannot** — Postgres forbids `FOR UPDATE` on aggregates — so they carry **no own lock** and are serialized by the budget-row lock the caller takes first.

| Method                                                                | Purpose                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScopedAccountRepository.findById`                                    | Serializes balance mutations (`CreateTransaction`, `DeleteTransaction`, `Archive`, `Unarchive`, `Rename`) on the same account row                                                                           |
| `ScopedBudgetRepository.findById`                                     | Serializes `UpdateBudgetLimit` and `DeleteBudget` against concurrent transaction creates                                                                                                                    |
| `ScopedBudgetRepository.findByUserIdAndCategoryIdAndPeriod`           | Serializes the budget-limit check inside `CreateTransaction`                                                                                                                                                |
| `ScopedTransactionRepository.findByIdWithLock`                                | Serializes concurrent `DELETE /transactions/:id` on the same row — second arrival sees null after first commits, throws `TransactionNotFoundException`, rolls back. Prevents double-reverse of the balance. |
| `ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod` | **No own lock** (aggregate). Serialized by the budget-row lock `CreateTransaction` takes first via `findByUserIdAndCategoryIdAndPeriod`                                                                                                                                           |
| `ScopedExpenseChecker.hasExpensesInPeriod`                            | **No own lock** (aggregate). Serialized by the budget-row `FOR UPDATE` `DeleteBudget` takes first                                                                                                         |
| `ScopedExpenseChecker.sumExpenseAmountInPeriod`                       | **No own lock** (aggregate). Serialized by the budget-row `FOR UPDATE` `UpdateBudgetLimit` takes first                                                                                          |
| `ScopedRefreshTokenRepository.findByTokenHashWithLock`                | Serializes two concurrent `/auth/refresh` calls on the same token — replay detection depends on this                                                                                                        |

The budget row functions as a **logical mutex** for its invariant ("Σ period expenses ≤ limit"). Any flow that mutates that invariant must take `FOR UPDATE` on the budget row first.

### Closed race conditions (historical)

Kept here so future contributors don't redo the analysis. All currently closed.

| ID     | Scenario                                                                      | How it was closed                                                                                                                                                                                          |
| ------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bug A  | `PATCH /budgets/:id/limit` racing `POST /transactions` (write skew on limit)  | `ScopedBudgetRepository.findById` and `findByUserIdAndCategoryIdAndPeriod` take `FOR UPDATE`. `CreateTransaction` reads the budget through the scoped repo, not the global use case.                       |
| Bug B  | Two concurrent `POST /transactions` on the same account (lost balance update) | `ScopedAccountRepository.findById` takes `FOR UPDATE`.                                                                                                                                                     |
| Bug E  | Two concurrent `POST /auth/register` with same email returned 500             | `UserRepositoryImpl.save()` catches `QueryFailedError` 23505 → `UserAlreadyExistsException` → 409.                                                                                                         |
| Race 1 | `DELETE /budgets/:id` racing `POST /transactions` (TOCTOU outside DB tx)      | `DeleteBudget` runs inside `IBudgetUnitOfWork`; `getScopedExpenseChecker().hasExpensesInPeriod` runs under the same `QueryRunner`, serialized by the budget-row `FOR UPDATE` taken first.                                                                |
| Race 2 | `PATCH /accounts/:id/{archive,unarchive,name}` racing transaction mutations   | All three rewritten to inject `IAccountUnitOfWork`; `findById` takes `FOR UPDATE` and competes with `CreateTransaction`/`DeleteTransaction`.                                                               |
| Race 3 | Two concurrent `DELETE /transactions/:id` (double-reverse balance)            | `ScopedTransactionRepository.findByIdWithLock` takes `FOR UPDATE`. `DeleteTransactionUseCase` does fail-fast outside UoW (cheap 404/403) then re-fetches inside UoW. Second arrival sees null after first commits. |
| B4     | `PATCH /budgets/:id/limit` could lower limit below already-spent amount       | `UpdateBudgetLimitUseCase` sums period expenses (`ScopedExpenseChecker.sumExpenseAmountInPeriod`, no own lock) under the budget-row `FOR UPDATE` and throws `BudgetLimitBelowSpentException` (→ 409) when `new limit < spent`.         |

---

## Authentication

### Refresh token model

Refresh tokens are persisted in `refresh_tokens` (consolidated `InitialSchema` migration). The plaintext token is **never stored** — only `sha256(token)`. Each token has:

- `id` — the JWT `jti` claim, also used as `replacedById` when this token is rotated.
- `familyId` — same UUID for the entire rotation chain. A login starts a new family; every rotation inherits it.
- `tokenHash` — `sha256(rawToken)`, unique.
- `expiresAt`, `revokedAt`, `replacedById`.

### Flows

- **Login** → emits `(access, refresh)`, persists the refresh entity (no UoW; single insert is atomic).
- **Refresh** → opens `IAuthUnitOfWork`. Reads the row by hash with `FOR UPDATE`. If revoked → revokes the entire family and throws `RefreshTokenReplayDetectedException` (the commit is intentional: the family must be locked out even if the request fails). If valid → revokes the old (with `replacedById = newJti`), inserts a new one with the same `familyId`, returns the new pair.
- **Logout** → revokes the current refresh token. Public endpoint (no access token required) so an expired access doesn't block sign-out.
- **Cleanup scheduler** → `@Cron('0 3 * * *')` deletes expired tokens daily.

### Why hash, why family, why replay revokes the family

- **Hash:** if the DB is leaked, attackers cannot use the tokens directly.
- **Family:** lets us atomically expel an entire compromised chain in one `UPDATE … WHERE family_id = $1`.
- **Replay → revoke family:** if a rotated token is presented again, either an attacker stole it after legitimate use, or the legitimate user replayed it (network retry, etc.). Either way the chain is compromised. We expel both rather than try to distinguish — distinguishing is unsafe.

### Timing-safe login

`LoginUseCase` always runs `bcrypt.compare` even when the user doesn't exist (against a constant `BCRYPT_DUMMY_HASH`), and returns a single generic `InvalidCredentialsException`. This prevents email enumeration via response-time timing.

### Throttling

`@Throttle({ auth: { limit: 5, ttl: 60_000 } })` on `AuthController` overrides the global throttle. Five requests per minute per IP for any auth endpoint.

---

## HTTP layer

### Ownership in controllers

Two coexisting patterns:

- **Delegation** — `GetXByIdUseCase` accepts `requestUserId`, throws `ResourceOwnershipException` on mismatch. Mutation use cases that don't need a UoW delegate to it and inherit the check.
- **Inline (UoW use cases)** — Use cases that already hold a `QueryRunner` do `if (entity.userId !== dto.requestUserId) throw new ResourceOwnershipException(id)` directly after `findById`. Avoids injecting another use case into an open transaction.

Both are correct. The choice is mechanical: if the use case is wrapped in a UoW, use inline; otherwise delegate.

### Exception → HTTP mapping

Single source of truth. **If you change a controller's mapping, change this table in the same PR.**

| HTTP | Domain exceptions                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `InvalidNameException`, `InvalidCategoryNameException`, `InvalidCategoryColorException`, `InvalidCategoryIconException`, `InvalidAmountLimitException`, `InvalidBudgetMonthException`, `InvalidBudgetYearException`, `InvalidAmountException`, `EmptyTransactionNatureException`, `InvalidTransactionNatureException`, `IncompatibleCategoryNatureException`, `NoTypeProvidedException`, `InvalidAccountTypeException`, `InvalidBalanceException`                              |
| 401  | `InvalidCredentialsException`, `InvalidRefreshTokenException`, `RefreshTokenExpiredException`, `RefreshTokenReplayDetectedException`, `UserNotFoundException` (auth/login only — collapsed into "invalid credentials" to avoid email enumeration)                                                                                                                                                                                                                              |
| 403  | `ResourceOwnershipException`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 404  | `UserNotFoundException` (users module), `AccountNotFoundException`, `CategoryNotFoundException`, `BudgetNotFoundException`, `TransactionNotFoundException`                                                                                                                                                                                                                                                                                                                     |
| 409  | `UserAlreadyExistsException`, `DuplicateCategoryException`, `CategoryInUseException`, `BudgetAlreadyExistsException`, `BudgetCategoryMustBeExpenseException`, `BudgetLimitBelowSpentException`, `BudgetHasTransactionsInPeriodException`, `BudgetRequiredForExpenseTransactionException`, `CannotOperateOnArchivedAccountException`, `CannotDeleteTransactionException`, `AccountAlreadyArchivedDomainException`, `AccountNotArchivedDomainException`, `AccountInUseException` |
| 422  | `BudgetLimitExceededException`, `InsufficientFundsException`                                                                                                                                                                                                                                                                                                                                                                                                                   |

**Rule:** every mapping above should be covered by at least one controller test. If a domain exception exists and isn't in this table, it will leak as 500.

### Endpoints

**Auth** (all `@Public()` — no JWT required)

| Method | Route            |
| ------ | ---------------- |
| POST   | `/auth/register` |
| POST   | `/auth/login`    |
| POST   | `/auth/refresh`  |
| POST   | `/auth/logout`   |

All other routes are protected by the global JWT guard (`APP_GUARD`). The actor is read from `@CurrentUser()`. Collection endpoints (`GET /accounts`, etc.) implicitly scope to the caller; item endpoints enforce ownership inside the use case.

**Users**
`GET /users/:id` · `PATCH /users/:id/profile` · `DELETE /users/:id`
(Account creation is `POST /auth/register`.)

**Accounts**
`POST /accounts` · `GET /accounts` · `GET /accounts/:id` · `PATCH /accounts/:id/name` · `PATCH /accounts/:id/archive` · `PATCH /accounts/:id/unarchive` · `DELETE /accounts/:id`

**Categories**
`POST /categories` · `GET /categories` · `GET /categories/:id` · `PATCH /categories/:id` · `DELETE /categories/:id`

**Budgets** (collection accepts `?month=&year=`)
`POST /budgets` · `GET /budgets` · `GET /budgets/:id` · `PATCH /budgets/:id/limit` · `DELETE /budgets/:id`

**Transactions** (collection accepts `?page=&limit=&from=&to=`)
`POST /transactions` · `GET /transactions` · `GET /transactions/account/:accountId` · `GET /transactions/:id` · `DELETE /transactions/:id`

---

## Defense in depth for unique constraints

Three layers, every time a uniqueness rule exists:

1. **DB unique constraint** — the actual guarantee.
2. **`catch QueryFailedError` code 23505** in the repository → maps to a domain exception (prevents raw 500).
3. **Application pre-check** in the use case before insert — fast fail, no wasted DB round-trip.

| Module         | DB constraint                                                    | catch 23505                              | Pre-check                                     |
| -------------- | ---------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| users          | `uq_users_email`                                                 | → `UserAlreadyExistsException`           | `GetUserByEmailUseCase`                       |
| categories     | `@Unique` on `(userId, name, nature)`                            | → `DuplicateCategoryException`           | — (pre-check removed; race-only path is fine) |
| budgets        | `@Unique` on `(userId, categoryId, month, year)`                 | → `BudgetAlreadyExistsException`         | —                                             |
| refresh_tokens | unique index on `tokenHash` (`idx_refresh_tokens_token_hash`)    | (no catch — collision is a sha256 break) | —                                             |

---

## Module summaries

- **users** — CRUD + bcrypt. Exports `GetUserByEmailUseCase`, `CreateUserUseCase`. Owns its own profile only.
- **auth** — Register, login, refresh, logout. `IPasswordHasher` (bcrypt) and `ITokenProvider` (JWT) ports with adapters in `infrastructure/adapters/`. Global `JwtAuthGuard` via `APP_GUARD` with `@Public()` opt-out. `JwtStrategy` populates `@CurrentUser()`. Refresh tokens persisted with rotation + family revocation. Daily cleanup scheduler.
- **accounts** — `Balance`, `AccountType` value objects. `inflow` / `outflow` / `archive` / `unarchive` semantics. **Archived accounts are dead**: cannot mutate balance (`CannotOperateOnArchivedAccountException`). `Archive`, `Unarchive`, `Rename` run inside `IAccountUnitOfWork`, competing for the same row lock as `CreateTransaction` / `DeleteTransaction`.
- **categories** — `CategoryNature` value object (`income` | `expense`). **Budgetability is derived from `nature`**: any `expense` category is budgetable. There is no `isBudgetable` flag (never present in the consolidated `InitialSchema` migration). Deletion blocked by FK (`CategoryInUseException` from catch 23503 **or 23001** — newer managed Postgres reports `restrict_violation` 23001 for `ON DELETE RESTRICT` FKs while local PG 15 reports 23503; catching only one of them 500s in the other environment. Same dual catch in accounts `delete()`).
- **budgets** — `AmountLimit` value object. One budget per `(user, category, month, year)` enforced by DB unique constraint + `catch 23505`. Category must be `expense` (`BudgetCategoryMustBeExpenseException`). `UpdateBudgetLimit` rejects `new limit < spent` under lock (`BudgetLimitBelowSpentException`). `DeleteBudget` rejects deletion when expenses exist in the period (`BudgetHasTransactionsInPeriodException`).
- **transactions** — Immutable records (no `update` use case — delete + recreate). `TransactionNature` (`income` | `expense`) and `Amount` value objects. Create rules: account exists and not archived, category exists with matching nature, expenses require an existing budget for the period and projected total ≤ limit. All creates and deletes run inside `ITransactionUnitOfWork`.

---

## Known gaps (not bugs, not blockers)

- **Missing partial index** for the period-sum query on `transactions(userId, categoryId, nature='expense', transactionDate)`. Current full-table scans are fine at small scale; revisit once the table grows. Note: adding it by hand reintroduces entity↔DB drift (TypeORM 0.3 doesn't model partial indexes) — decide consciously.
- **Partial observability.** Prometheus metrics (`/metrics`) and structured logs (pino) are in place; **distributed tracing and error tracking (Sentry) are still missing.**
- See `docs/history/hardening-audit-2026-04.md` for the broader audit and roadmap.

> **Resolved (was a gap):** throttler storage is now **Redis-backed** (`ThrottlerStorageRedisService` in `app.module.ts`) — per-IP limits hold across instances.

> **Resolved (was a gap):** the integration suite under `test/integration/` (auth, users, accounts, categories, budgets, transactions, concurrency) is active — `npm run test:integration` against a real Postgres. The old `.bak` disabling is gone.

> **Resolved (was a gap):** `ITransactionRepository` is split into a query port (`findById`/`findByAccountId`/`findByUserId`) and a command port `IScopedTransactionRepository` (`findByIdWithLock`/`sum`/`save`/`delete`). The global repo can no longer write outside the UoW — it is enforced by types. The dead `IExpenseChecker` binding (`ExpenseCheckerImpl`) was removed; the port is served only by `ScopedExpenseChecker` inside the UoW.

---

## Deployment

Build → Release → Run (12-factor). Full runbook in `docs/deployment.md`.

- **Build:** multi-stage `Dockerfile` → `node:20-alpine` runtime with `dist/` + prod deps only, non-root user, `tini` as PID 1 (forwards SIGTERM so `enableShutdownHooks()` closes cleanly).
- **Release:** `docker-entrypoint.sh` runs `migration:run` against `dist/data-source.js` **before** the app starts (`RUN_MIGRATIONS=false` to skip when a separate Job handles it).
- **`data-source.ts` is env-aware:** detects compiled (`.js`→`dist/`) vs ts-node (`.ts`→`src/`) so the same file serves dev and the prod image. Prod scripts: `migration:run:prod`, `migration:show:prod`.
- **DB connection:** `DB_SSL` (TLS for managed Postgres) + pool (`DB_POOL_MAX`, `DB_CONNECTION_TIMEOUT_MS`) in `app.module.ts` and `data-source.ts`.
- **Bootstrap hardening (`main.ts`):** `TRUST_PROXY` (real client IP behind a LB, required for per-IP throttling), CORS forbids `'*'` in production (enforced by Joi in `env.validation.ts`).
- **Health:** `/health` (liveness, `AppController`) and `/ready` (readiness via `@nestjs/terminus`, `src/shared/infrastructure/health/`) — both `@Public()` and excluded from the `api/v1` prefix.

---

## Anti-patterns — do not do

- **Do not** reintroduce `isBudgetable` on `Category`. Budgetability is derived from `nature === 'expense'`. The flag was removed because it created two sources of truth that drifted.
- **Do not** store refresh tokens in plaintext. Always `sha256(token)`.
- **Do not** enable `synchronize` in production. Migrations only.
- **Do not** add `@CreateDateColumn` / `@UpdateDateColumn` to ORM entities. TypeORM overwrites the domain-controlled timestamps on every `save()`. Use plain `@Column` and let the entity own them.
- **Do not** take `userId` from the request body or URL. Always `@CurrentUser()`.
- **Do not** call `VO.create()` in a mapper. Use `VO.reconstitute()` so persisted data isn't re-validated.
- **Do not** throw `HttpException` from the domain layer. Domain throws domain exceptions; controllers map.
- **Do not** inject `DataSource` directly in a use case. Use the module's UoW port. If the existing port doesn't expose what you need, extend the port and add a getter to `TypeOrmUnitOfWorkImpl` (or `AuthUnitOfWorkImpl` for auth-only flows).
- **Do not** read inside an open UoW with the global (non-scoped) repository. The global repo runs on a different connection — locks won't apply, and you'll think your invariant is protected when it isn't.
