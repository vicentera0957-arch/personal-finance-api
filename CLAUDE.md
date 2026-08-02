# Personal Finance API — CLAUDE.md

Source of truth for collaborators (humans and AI). Mixes **reference** (tables, lists) and **mental model** (the _why_). When the code and this doc disagree, the code wins — but open a PR to fix the doc in the same change.

---

## Stack & commands

Stack and npm scripts are in `package.json`. What that file does **not** tell you:

- **Local DB:** `docker-compose` exposes Postgres on port **5433** (not 5432) and pgAdmin on 5051. Use `DB_PORT=5433` in `.env`. The integration suite reads `test/.env.test`, which also points at 5433 — if the compose stack isn't up, every integration suite fails at bootstrap with an unrelated-looking error.
- **Schema in dev:** `synchronize` is opt-in via `DB_SYNCHRONIZE=true` AND `NODE_ENV !== 'production'`. Default is `false` — migrations are the path. Note: `synchronize` only creates tables from entities, **not** the `v_period_expenses` view (it has no entity), so a dev DB built with `DB_SYNCHRONIZE=true` will lack the view and break any query that reads it. Run `migration:run` — the view lives in a hand-written migration, never in `migration:generate` output.

---

## Architecture

Every module has the same `domain/` → `application/` → `infrastructure/` skeleton; `ls src/modules/<module>` shows the layout. The rules that the layout does **not** show:

- `domain/` is pure — no NestJS, no TypeORM, no HTTP. That prohibition is the whole point of the layer.
- `application/use-cases/` is one class per use case with a single `execute()`.
- `reports` is the one sanctioned exception to the three layers (see the read-model section under "Patterns").

### Why DDD with abstract-class ports

NestJS DI needs a runtime token. TypeScript `interface` is erased at compile time, so it can't be a token. **Repository ports and UoW ports are `abstract class`** — they double as types and as injection tokens. Concrete implementations are bound via `{ provide: IFooRepository, useClass: FooRepositoryImpl }`.

This is non-negotiable: switching ports to `interface` breaks the DI graph.

### Module hierarchy

```
auth → users → (accounts, categories, budgets, transactions)
reports → (schema-only dependency on transactions, via the v_period_expenses view)
```

- `auth` sits above `users` because login/register call `GetUserByEmailUseCase` and `CreateUserUseCase`.
- Domain modules (accounts, categories, budgets, transactions) are peers but with one direction of dependency: **transactions → budgets → categories → accounts**. There are **zero** module cycles and zero `forwardRef()` calls in the graph — the last one, `budgets ↔ transactions`, closed by moving `IBudgetUnitOfWork`'s implementation into `budgets` itself (see "Why `IBudgetUnitOfWork` is separate" below) instead of keeping the port-owned-by-consumer split across modules.
- **`accounts` is a leaf.** It owns its own `AccountUnitOfWorkImpl`, so it imports no other module and nothing of `transactions`. The `accounts ↔ transactions` cycle (and its `forwardRef`) is gone; `transactions → accounts` remains, one-way, because the multi-aggregate invariant lives in transactions.
- **`budgets` is a leaf too** (aside from `CategoriesModule`, itself a leaf). It owns its own `BudgetUnitOfWorkImpl` and no longer imports `TransactionsModule`; `transactions → budgets` remains, one-way, for the same reason — the multi-aggregate invariant (`CreateTransaction` locking the budget row before summing period expenses) lives in transactions, not in budgets.
- `reports` imports **no** other module. Its only link to `transactions` is at the **schema** level (the view reads the `transactions` table); there is zero compile-time coupling. See the reports read-model section under "Patterns".

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

**Historical example (no longer live):** `IExpenseChecker` used to live in `budgets/domain/repository/expense-checker.port.ts` (now `budgets/domain/ports/expense-checker.port.ts` — moved again, separately from the module-cycle fix, because a repository port models an aggregate's persistence lifecycle and this one answers a derived query instead) while its only implementation, `ScopedExpenseChecker`, lived inside `transactions/infrastructure/persistence/unit-of-work.impl.ts` — reached via `forwardRef(() => TransactionsModule)` in `budgets.module.ts`. That was the last cycle in the module graph. It closed the same way the `accounts ↔ transactions` cycle did: instead of keeping the split, the class moved to live next to its port. Port and implementation (`ScopedExpenseChecker`, `budgets/infrastructure/persistence/scoped-expense-checker.ts`) both live in `budgets` now, served by `BudgetUnitOfWorkImpl`. There is currently **no live example** of this pattern anywhere in the codebase — the module graph has zero cycles and zero `forwardRef()` calls. The pattern stays documented because it is the correct fix *if* a genuine cycle reappears; it is not dead weight to keep it described here without an instance.

### 6. `reports`: a read model with **no `domain/` layer** (documented exception)

Every other module has the three-layer skeleton. `reports` deliberately does **not** have a `domain/` folder — no entities, no value objects, no mappers, no `reconstitute()`, no UoW, no locks. This is the one sanctioned exception to "each module has three layers", and it exists because reports is a **read model** (CQRS-lite): it only aggregates already-persisted rows to answer queries. There are no write-side invariants to protect, so the machinery that protects them (rich entities, VO re-validation, pessimistic locks) would be pure cost.

Consequences and rules:

- The port `IReportsReadStore` lives in `reports/application/ports/` (not `domain/`), because with no domain layer the innermost layer is `application`, and the use case owns the contract. It is still an `abstract class` (DI-token convention, non-negotiable).
- The impl (`ReportsReadStoreImpl`) injects `DataSource` directly. This does **not** violate the "no `DataSource` in use cases" anti-pattern: that rule protects the write-side lock model, and there are no locks here. The prohibition is about use cases; infrastructure read stores are fine (precedent: `TypeOrmUnitOfWorkImpl` injects `DataSource` too).
- **The exception is scoped to pure read aggregation.** The day reports needs to mutate state, enforce an invariant, or run non-trivial app-side computation, it must be promoted to a full module with a `domain/` layer. Do not use this section as a license to skip `domain/` in modules that write.
- `v_period_expenses` (a DB view, created by a hand-written migration — see the migrations note) is the **single definition of "what counts as an expense"**, shared by `GET /reports/summary` and the three budget-enforcement aggregates in the UoW. It is **not** registered as a `@ViewEntity`: TypeORM only manages views tracked in `typeorm_metadata`, so a raw-SQL view is invisible to `migration:generate` (verified with a dry-run — it reports "No changes"). Never accept a generated migration that tries to `DROP` or recreate it.
- `monthPeriod(year, month)` in `shared/domain/` is the **single definition of a monthly period's `[start, end)` bounds**, shared by reports and the same three UoW aggregates. It is the one place to fix the pending timezone-semantics question (`transaction_date` is `TIMESTAMP` without zone; the bounds are computed in the server's local time).
- **No cache in v1.** The repo has a per-module Redis cache pattern (`IBudgetsCache`), but reports intentionally skips it: invalidating a reports cache would couple `transactions → reports` (every create/delete would have to bust report keys). Deferred until monitoring shows a need — a decision, not a gap.

---

## Concurrency: Unit of Work + pessimistic locks

### The model

The system has **four** concrete UoW implementations, satisfying **four** module-specific ports — a 1:1 mapping now that `IBudgetUnitOfWork` has its own impl:

| Port                     | Owner                 | Used by                                  | Implemented by          |
| ------------------------ | --------------------- | ---------------------------------------- | ----------------------- |
| `IUnitOfWork`            | `shared/domain`       | (base — lifecycle only)                  | all four impls          |
| `ITransactionUnitOfWork` | `transactions/domain` | `CreateTransaction`, `DeleteTransaction` | `TypeOrmUnitOfWorkImpl` |
| `IBudgetUnitOfWork`      | `budgets/domain`      | `UpdateBudgetLimit`, `DeleteBudget`      | `BudgetUnitOfWorkImpl`  |
| `IAccountUnitOfWork`     | `accounts/domain`     | `Archive`, `Unarchive`, `Rename`         | `AccountUnitOfWorkImpl` |
| `IAuthUnitOfWork`        | `auth/domain`         | `RefreshToken`                           | `AuthUnitOfWorkImpl`    |

**`TypeOrmUnitOfWorkImpl`** lives in `transactions/infrastructure/` and now serves only `ITransactionUnitOfWork`. It used to also `implement IBudgetUnitOfWork`, aliased via `useExisting` to the same request-scoped instance — that alias is gone; see "Why `IBudgetUnitOfWork` is separate" below.

Historical note on what that old sharing did and did **not** buy (kept because the same reasoning applies to every future decision of this kind). It was required **within one request**, so that a use case taking several scoped repos gets them all on one transaction — only `CreateTransaction` ever needed that. It bought nothing **between** requests: `Scope.REQUEST` already means one instance per request, so two concurrent requests always had distinct `QueryRunner`s. What serializes them is the Postgres row lock, not the shared instance. That is why a module whose flows touch a single aggregate can own its UoW without weakening anything — the same argument that already justified `IAccountUnitOfWork` and `IAuthUnitOfWork`, and now justifies `IBudgetUnitOfWork` too.

```ts
// transactions.module.ts
{ provide: TypeOrmUnitOfWorkImpl,  useClass: TypeOrmUnitOfWorkImpl, scope: Scope.REQUEST }
{ provide: ITransactionUnitOfWork, useExisting: TypeOrmUnitOfWorkImpl }

// budgets.module.ts
{ provide: BudgetUnitOfWorkImpl,   useClass: BudgetUnitOfWorkImpl, scope: Scope.REQUEST }
{ provide: IBudgetUnitOfWork,      useExisting: BudgetUnitOfWorkImpl }
```

### Why the impl lives in `transactions/`

Every **multi-aggregate** invariant in this domain is anchored to a `Transaction` mutation: balance update, budget-limit enforcement, period-spent sums. Those are the only flows that need several scoped repos inside one transaction, so `transactions` is the natural home for the impl that composes them.

The scope of that claim is narrow, and the rule that follows from it is: **a module whose transactional flows touch only its own aggregate owns its UoW impl.** `Archive` / `Unarchive` / `Rename` take only the account repo, so `accounts` owns `AccountUnitOfWorkImpl` — same reasoning that already kept `auth` separate. What stays in `transactions` is the *composition* of the three-aggregate boundary, not the persistence of its neighbours.

### Why `IAccountUnitOfWork` is separate

`Archive`, `Unarchive` and `Rename` need a transaction and a `FOR UPDATE` on the account row — nothing else. Serving that from the transactions impl forced `accounts` to import `TransactionsModule` just to resolve the token, which closed a module cycle for no domain reason. `AccountUnitOfWorkImpl` lives in `accounts/infrastructure/`, and `accounts` is now a leaf. Cross-request serialization against `CreateTransaction` / `DeleteTransaction` is unaffected: both paths lock the same row, and locks live in Postgres, not in the instance.

### Why `IBudgetUnitOfWork` is separate

`UpdateBudgetLimit` and `DeleteBudget` need a transaction, a `FOR UPDATE` on the budget row, and one aggregate read (`IExpenseChecker`) under that lock — nothing else. Serving that from the transactions impl forced `budgets` to import `TransactionsModule` (`forwardRef(() => TransactionsModule)` in `budgets.module.ts`) just to resolve the `IBudgetUnitOfWork` token — a token `transactions` itself never injected. That was the last module cycle in the graph.

`BudgetUnitOfWorkImpl` lives in `budgets/infrastructure/persistence/budget-unit-of-work.impl.ts` and `budgets` is now a leaf module (it still imports `CategoriesModule`, which imports nothing). `ScopedExpenseChecker` moved with it — `budgets/infrastructure/persistence/scoped-expense-checker.ts` — since its only two consumers, `DeleteBudgetUseCase` and `UpdateBudgetLimitUseCase`, both live in `budgets`.

`ScopedBudgetRepository` did **not** move to being private to `budgets`, unlike `ScopedExpenseChecker`. `CreateTransactionUseCase` still needs to lock the budget row before summing period expenses — that read happens on `TypeOrmUnitOfWorkImpl`'s own `QueryRunner`, inside the multi-aggregate transaction, and has nothing to do with `IBudgetUnitOfWork`. So `ScopedBudgetRepository` took the same shape as `ScopedAccountRepository`: unexported class in `budgets/infrastructure/persistence/scoped-budget.repository.ts`, reached only through `createScopedBudgetRepository(queryRunner, mapper)`, called independently by `TypeOrmUnitOfWorkImpl` (its own `QueryRunner`) and by `BudgetUnitOfWorkImpl` (its own `QueryRunner`). Two transactions, same factory, same lock semantics — never the same instance.

Cross-request serialization against `CreateTransaction` is unaffected by any of this split: `CreateTransaction`, `UpdateBudgetLimit` and `DeleteBudget` all still lock the *same* budget row before doing anything invariant-sensitive; the lock lives in Postgres, not in a shared UoW instance. `test/integration/concurrency/concurrency.integration.spec.ts` (specifically the "respects the limit even when the period starts empty" scenario) is the regression net that proves this.

### Why `IAuthUnitOfWork` is separate

Auth's transactional boundary is independent: refresh-token rotation only touches `refresh_tokens`. There is no shared invariant between auth and the financial aggregates. Mixing them into one impl would couple two unrelated bounded contexts and force `AuthModule` to depend on `transactions` at the DI layer. So `AuthUnitOfWorkImpl` lives in `auth/infrastructure/`, with its own `ScopedRefreshTokenRepository`.

### Scoped resources

`TypeOrmUnitOfWorkImpl` exposes three scoped resources, all sharing the same `EntityManager`(typeorm):

- `getScopedTransactionRepository()` → `ScopedTransactionRepository`
- `getScopedAccountRepository()` → `ScopedAccountRepository` (built from `accounts`' factory — see below)
- `getScopedBudgetRepository()` → `ScopedBudgetRepository` (built from `budgets`' factory — see below)

`AccountUnitOfWorkImpl` exposes one:

- `getScopedAccountRepository()` → `ScopedAccountRepository`

`BudgetUnitOfWorkImpl` exposes two:

- `getScopedBudgetRepository()` → `ScopedBudgetRepository` (same factory `TypeOrmUnitOfWorkImpl` calls, its own `QueryRunner`)
- `getScopedExpenseChecker()` → `ScopedExpenseChecker`

The auth UoW exposes:

- `getRefreshTokenRepository()` → `ScopedRefreshTokenRepository`

These classes take pessimistic locks aggressively because, by construction, they only ever execute inside an active `QueryRunner` — reading by id inside a transaction implies intent to mutate.

**How that "by construction" is enforced.** Two shapes coexist:

- **Private to the impl file** — the class is declared in the same file as the UoW that hands it out, and never exported (`ScopedTransactionRepository`, `ScopedRefreshTokenRepository`). The guarantee is syntactic: it holds only while there is exactly one consumer.
- **Private class + exported factory** — used when a second module legitimately needs the same scoped repo on *its* `QueryRunner`. Two instances of this shape today, both with the same signature (`createScopedX(queryRunner, mapper)`, guard first, `new` last):
  - `ScopedAccountRepository` (`accounts/infrastructure/persistence/scoped-account.repository.ts`) — consumed by both `AccountUnitOfWorkImpl` and `TypeOrmUnitOfWorkImpl`.
  - `ScopedBudgetRepository` (`budgets/infrastructure/persistence/scoped-budget.repository.ts`) — consumed by both `BudgetUnitOfWorkImpl` and `TypeOrmUnitOfWorkImpl`, for the same reason: `CreateTransaction` locks the budget row on its own `QueryRunner`, independent of `UpdateBudgetLimit` / `DeleteBudget` locking it on theirs.
  - `ScopedExpenseChecker` (`budgets/infrastructure/persistence/scoped-expense-checker.ts`) has only **one** consumer today (`BudgetUnitOfWorkImpl`) but still uses this shape — factory in its own file (`createScopedExpenseChecker(queryRunner)`) rather than embedded inline in `budget-unit-of-work.impl.ts`. That is deliberate, not an inconsistency: the class moved from `transactions` as a unit during the cycle-break refactor, and keeping it in its own file matches `ScopedBudgetRepository`'s shape next to it, in case a second consumer ever appears. A single-consumer class is free to move to the "private to the impl file" shape if that stops being true.

**The factory takes a `QueryRunner`, never an `EntityManager`.** That is the whole point: `dataSource.manager` is an `EntityManager`, so passing it stops *compiling*. A `QueryRunner` that is connected but has no open transaction is still type-correct and still silently useless, so the factory also throws on `isReleased || !isTransactionActive`. Never publish a scoped repository class directly — a `FOR UPDATE` that quietly does nothing is the worst failure mode in this system, and no integration test reliably catches it.

### Locking & serialization map

Row-based reads (`findById`, `findByTokenHashWithLock`) take `FOR UPDATE`. Aggregate reads (`SUM`/`COUNT`) **cannot** — Postgres forbids `FOR UPDATE` on aggregates — so they carry **no own lock** and are serialized by the budget-row lock the caller takes first.

| Method                                                                | Purpose                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScopedAccountRepository.findById`                                    | Serializes balance mutations (`CreateTransaction`, `DeleteTransaction`, `Archive`, `Unarchive`, `Rename`) on the same account row. Lives in `accounts/infrastructure/persistence/scoped-account.repository.ts`; the two callers reach it through **different** UoWs and therefore different `QueryRunner`s — they still serialize, because the lock is on the row |
| `ScopedBudgetRepository.findById`                                     | Serializes `UpdateBudgetLimit` and `DeleteBudget` against concurrent transaction creates. Lives in `budgets/infrastructure/persistence/scoped-budget.repository.ts`; `BudgetUnitOfWorkImpl` and `TypeOrmUnitOfWorkImpl` reach it through the same factory on **different** `QueryRunner`s — they still serialize, because the lock is on the row (same shape as `ScopedAccountRepository` above) |
| `ScopedBudgetRepository.findByUserIdAndCategoryIdAndPeriod`           | Serializes the budget-limit check inside `CreateTransaction`                                                                                                                                                |
| `ScopedTransactionRepository.findByIdWithLock`                                | Serializes concurrent `DELETE /transactions/:id` on the same row — second arrival sees null after first commits, throws `TransactionNotFoundException`, rolls back. Prevents double-reverse of the balance. |
| `ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod` | **No own lock** (aggregate). Serialized by the budget-row lock `CreateTransaction` takes first via `findByUserIdAndCategoryIdAndPeriod`                                                                                                                                           |
| `ScopedExpenseChecker.hasExpensesInPeriod`                            | **No own lock** (aggregate). Serialized by the budget-row `FOR UPDATE` `DeleteBudget` takes first. Closes Race 1. Lives in `budgets/infrastructure/persistence/scoped-expense-checker.ts`, served by `BudgetUnitOfWorkImpl` — moved out of `transactions/infrastructure/persistence/unit-of-work.impl.ts`, where it lived before the `IBudgetUnitOfWork` split |
| `ScopedExpenseChecker.sumExpenseAmountInPeriod`                       | **No own lock** (aggregate). Serialized by the budget-row `FOR UPDATE` `UpdateBudgetLimit` takes first. Closes B4. Same file/history as the row above |
| `ScopedRefreshTokenRepository.findByTokenHashWithLock`                | Serializes two concurrent `/auth/refresh` calls on the same token — replay detection depends on this                                                                                                        |

The budget row functions as a **logical mutex** for its invariant ("Σ period expenses ≤ limit"). Any flow that mutates that invariant must take `FOR UPDATE` on the budget row first.

> The three aggregate rows above (`sumExpenseAmountByUserCategoryAndPeriod`, `hasExpensesInPeriod`, `sumExpenseAmountInPeriod`) now read `FROM v_period_expenses` — the shared "what counts as an expense" definition, also consumed by `GET /reports/summary` (see the reports read-model section). This is a **read-source** change, not a locking change: the view is a stateless macro that Postgres **inlines** into the plan (verified: same `Index Scan using idx_tx_user_cat_nature_date` as before), and the queries still run on the UoW's `EntityManager` (same `QueryRunner` → same transaction), so the budget-row lock the caller takes first still serializes them. Since the view has no entity metadata, these three queries use **raw snake_case columns** and a bare `createQueryBuilder().from('v_period_expenses', 'e')`.

### Closed race conditions (historical)

Seven closed races (Bug A/B/E, Race 1/2/3, B4) with the analysis that closed each one:
`docs/history/closed-race-conditions.md`. Read it before changing anything in the locking map above
— it is why each lock exists. The regression net is
`test/integration/concurrency/concurrency.integration.spec.ts`, and those scenarios must keep
passing **unmodified**.

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

One global bucket (`default`: `THROTTLE_LIMIT` per minute, per IP, per route). `AuthController` overrides **that same bucket** with `@Throttle({ default: { limit: 5, ttl: 60_000 } })` — five requests per minute per IP for any auth endpoint (env-tunable via `THROTTLE_AUTH_LIMIT` / `THROTTLE_AUTH_TTL`).

**Do not register a second named throttler in `app.module.ts` to achieve this.** `ThrottlerGuard` applies *every* registered throttler to *every* route unless the route opts out with `@SkipThrottle` — a named `auth` bucket of 5/min ends up rate-limiting the entire API at 5 req/min per route. This was a real production bug (429 on `POST /categories` during demo seeding; `x-ratelimit-limit-auth: 5` visible even on `/health`), fixed by collapsing to a single bucket + per-controller override of `default`.

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

The route table is in the controllers (`src/modules/*/infrastructure/http/*/`). What the decorators don't tell you:

- **All four `/auth/*` routes are `@Public()`**; every other route is protected by the global JWT guard (`APP_GUARD`). The actor comes from `@CurrentUser()` — collection endpoints implicitly scope to the caller, item endpoints enforce ownership inside the use case.
- **`GET /reports/summary?month=&year=` requires both params.** A "current month" default would depend on the server timezone, and requiring the pair caps query cost to a single month by construction. Empty period → `200` with zeros, not `404`.
- **Transactions have no update route.** They are immutable by design: delete and recreate.

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
- **reports** — Read model (CQRS-lite), **no `domain/` layer** (see the documented exception under "Patterns"). One endpoint today: `GET /reports/summary?month=&year=` → `{ month, year, income, expenses, net }`, scoped to `@CurrentUser()`. Single aggregated SQL statement (one MVCC snapshot → income/expenses mutually consistent without a transaction), no locks, no cache. `expenses` reads the shared `v_period_expenses` view; empty period returns zeros (200, not 404) so it raises no domain exceptions.

---

## Known gaps (not bugs, not blockers)

- **Partial observability.** Prometheus metrics (`/metrics`) and structured logs (pino) are in place; **distributed tracing and error tracking (Sentry) are still missing.**
- See `docs/history/hardening-audit-2026-04.md` for the broader audit and roadmap.

> **Resolved (was a gap):** the "missing partial index" for the period-sum query was **documentation drift** — the composite index `idx_tx_user_cat_nature_date` on `transactions(userId, categoryId, nature, transactionDate)` exists since `InitialSchema` and covers the query (benchmarked: sub-ms Bitmap Index Scan; see `docs/period-sum-index-decision.md`, approved 2026-07-02). A **partial** index (`WHERE nature='expense'`) would only pay off at millions of rows, and TypeORM 0.3 can't model it declaratively (entity↔DB drift if added by hand) — decision: **don't add it**; revisit only if monitoring shows index size or write latency problems.

> **Resolved (was a gap):** throttler storage is now **Redis-backed** (`ThrottlerStorageRedisService` in `app.module.ts`) — per-IP limits hold across instances.

> **Resolved (was a gap):** the integration suite under `test/integration/` (auth, users, accounts, categories, budgets, transactions, concurrency) is active — `npm run test:integration` against a real Postgres. The old `.bak` disabling is gone.

> **Resolved (was a gap):** `ITransactionRepository` is split into a query port (`findById`/`findByAccountId`/`findByUserId`) and a command port `IScopedTransactionRepository` (`findByIdWithLock`/`sum`/`save`/`delete`). The global repo can no longer write outside the UoW — it is enforced by types. The dead `IExpenseChecker` binding (`ExpenseCheckerImpl`) was removed; the port is served only by `ScopedExpenseChecker` inside the UoW.

---

## Deployment

Build → Release → Run (12-factor). **Full runbook: `docs/deployment.md`** — read it before touching
the `Dockerfile`, `docker-entrypoint.sh` or the prod migration flow.

The two traps that bite outside a deploy:

- **`data-source.ts` is env-aware** — it detects compiled (`.js`→`dist/`) vs ts-node (`.ts`→`src/`) so
  one file serves dev and the prod image. Change it carelessly and migrations break in exactly one
  of the two environments.
- **Migrations run at release, not at boot** — `docker-entrypoint.sh` applies them before the app
  starts (`RUN_MIGRATIONS=false` when a separate Job handles it).

---

## Anti-patterns — do not do

- **Do not** reintroduce `isBudgetable` on `Category`. Budgetability is derived from `nature === 'expense'`. The flag was removed because it created two sources of truth that drifted.
- **Do not** store refresh tokens in plaintext. Always `sha256(token)`.
- **Do not** enable `synchronize` in production. Migrations only.
- **Do not** add `@CreateDateColumn` / `@UpdateDateColumn` to ORM entities. TypeORM overwrites the domain-controlled timestamps on every `save()`. Use plain `@Column` and let the entity own them.
- **Do not** take `userId` from the request body or URL. Always `@CurrentUser()`.
- **Do not** call `VO.create()` in a mapper. Use `VO.reconstitute()` so persisted data isn't re-validated.
- **Do not** throw `HttpException` from the domain layer. Domain throws domain exceptions; controllers map.
- **Do not** inject `DataSource` directly in a use case. Use the module's UoW port. If the existing port doesn't expose what you need, extend the port and add a getter to the impl that serves it (`AccountUnitOfWorkImpl`, `AuthUnitOfWorkImpl`, or `TypeOrmUnitOfWorkImpl` for the multi-aggregate boundary).
- **Do not** declare a provider for another module's UoW token. A module that needs a transactional boundary over its own aggregate implements its own UoW; serving it from a neighbour is what created the `accounts ↔ transactions` cycle and, later, the `budgets ↔ transactions` one. As of the `IBudgetUnitOfWork` split, every module-specific UoW port has exactly one impl in its own module — there is no more sharing left to imitate.
- **Do not** read inside an open UoW with the global (non-scoped) repository. The global repo runs on a different connection — locks won't apply, and you'll think your invariant is protected when it isn't.
- **Do not** inject more than one UoW port into a single use case. Before the `IBudgetUnitOfWork` split, `useExisting` made this structurally impossible for `ITransactionUnitOfWork` + `IBudgetUnitOfWork` — both tokens resolved to the same instance, so there was only ever one `QueryRunner` to open regardless of how many UoW ports a use case injected. That guarantee is gone now that the two ports have independent impls with independent `QueryRunner`s: a use case that injected both and called `begin()` on each would open two separate DB transactions and could deadlock against itself (e.g. one waiting on a lock the other is holding, or a partial commit if only one side fails). Nothing in the type system stops this — it is an accepted cost of the split, not engineered against. If a use case must coordinate two aggregates in one transaction, that is the definition of a multi-aggregate boundary: it belongs in the UoW that already owns that composition (`TypeOrmUnitOfWorkImpl` in `transactions`, today the only multi-aggregate impl), which exposes the neighbours' scoped repos as additional getters — not by injecting two module-specific UoW ports side by side.
