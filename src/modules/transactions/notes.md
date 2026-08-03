# `transactions` module — Current reference

## Domain

### Value objects

**`TransactionNature`** (`domain/value-objects/transaction-nature.vo.ts`)
Valid values: `income` | `expense`. Intentionally separate from `CategoryNature` — they are distinct bounded contexts that can evolve independently. It doesn't include `transfer` (transfers are a separate entity in the DB schema).

**`Amount`** (`domain/value-objects/amount.vo.ts`)
A transaction amount in CLP. Validations: finite number, integer, strictly greater than zero. Separate from `Balance` (which belongs to `accounts`) because they represent different concepts: `Amount` is a point-in-time amount, `Balance` is an accumulated balance. `Balance` allows zero; `Amount` doesn't.

### `Transaction` entity

Private constructor. Two factory methods:
- `Transaction.create(props)` — generates `createdAt`
- `Transaction.reconstitute(props)` — rebuilds from persistence without generating timestamps

Properties: `id`, `userId`, `accountId`, `categoryId`, `nature` (`TransactionNature`), `amount` (`Amount`), `description?`, `transactionDate`, `createdAt`.

No `updatedAt` — transactions are immutable accounting records. Correction = delete + recreate.

No mutation methods (only getters). This reflects that an accounting transaction is not "edited"; it is counter-entered.

### Domain exceptions

| Exception | When |
|-----------|--------|
| `TransactionNotFoundException` | `findById` returns null |
| `IncompatibleCategoryNatureException` | `category.nature !== transaction.nature` (R7) |
| `BudgetLimitExceededException` | Projected spend > `budget.limit` |
| `BudgetRequiredForExpenseTransactionException` | Expense without a budget in the period |
| `CannotDeleteTransactionException` | Reversing an income would leave the balance negative |

### `ITransactionRepository` port

Abstract class (required for DI in NestJS). Methods:
- `findById`, `findByAccountId`, `findByUserId`, `save`, `delete`
- `sumExpenseAmountByUserCategoryAndPeriod` — sum query to validate R8

### `ITransactionUnitOfWork` port

**File:** `domain/ITransactionUnitOfWork.ts`

Abstract class that **extends `IUnitOfWork<TransactionTxContext>`** (`shared/domain`). The contract (`run<T>(work)` — that is the only method) is cross-cutting, inherited from that abstraction and documented there — **it is not re-documented here**. `ITransactionUnitOfWork` itself declares no members beyond the inherited `run()`.

What this port's `TCtx` (`TransactionTxContext`) **adds** are the properties `CreateTransactionUseCase` and `DeleteTransactionUseCase` read off the callback to coordinate writes across the three aggregates within a single transaction:

- `ctx.transactions` → scoped `IScopedTransactionRepository`
- `ctx.accounts` → scoped `IAccountRepository`
- `ctx.budgets` → scoped `IBudgetRepository`

These used to be getter methods on the UoW instance (`getScopedTransactionRepository()`, etc.); since `PLAN-P3P4-transactional-runner.md`, they are properties of the object `run()`'s callback receives, built once per call inside `createContext()`.

The three scoped repos share the active `QueryRunner`'s `EntityManager`, so every read/write runs in the same PostgreSQL transaction. By construction (they are only obtained via the UoW, already inside an open tx) their by-id reads take `FOR UPDATE` — see the *Architectural decision — locks in scoped repos* section below.

> The base `IUnitOfWork` port is not documented in this module: it lives in `shared/domain` and is also consumed by `IBudgetUnitOfWork`, `IAccountUnitOfWork` and `IAuthUnitOfWork`. Documenting its contract here would duplicate the abstraction.

---

## Application layer

### `CreateTransactionUseCase`

**Pre-transaction flow (outside the UoW):**
1. Creates the `TransactionNature` and `Amount` VOs
2. Validates the account exists and belongs to the user (`GetAccountByIdUseCase`)
3. Validates the category exists, belongs to the user, and its nature matches the transaction's (R7)
4. If it is an expense: validates a budget exists for the period (fails fast without opening the transaction). The category must be `expense`; "budgetability" is **derived from `nature`**, not from an `isBudgetable` flag (that flag was removed).

**Flow inside the UoW:** everything below runs inside `uow.run(async (ctx) => { ... })`. `run()` opens the `QueryRunner` and starts the PG transaction before invoking the callback, commits on a clean return, rolls back on a thrown error, and always releases — there is no `begin()`/`commit()`/`rollback()` call in the use case itself.
1. `ctx.budgets.findByUserIdAndCategoryIdAndPeriod(...)` (scoped repo, implicit `FOR UPDATE`) — **the invariant's gate**: locks the period's budget row before reading any data that feeds the decision. It is the only object that always exists and that every concurrent writer of the period goes through.
2. `ctx.transactions.sumExpenseAmountByUserCategoryAndPeriod(...)` (no own lock) — runs post-gate, so under `READ COMMITTED` it sees prior commits. Consistency comes from the budget lock, not from a `FOR UPDATE` over the range (which doesn't prevent phantoms).
3. `UpdateAccountBalanceUseCase(ctx.accounts).execute(...)` — updates the balance using the scoped repository (implicit pessimistic lock in `findById`)
4. `ctx.transactions.save(transaction)` — persists the transaction
5. Return the saved transaction — `run()` commits and releases on the way out; nothing left for the use case to call.

### `DeleteTransactionUseCase`

Similar to create but in reverse, inside the same `uow.run(async (ctx) => { ... })` shape:
1. Retrieves the transaction and the account
2. Verifies the owner matches
3. Balance revert + transaction delete in the same callback, on the same `QueryRunner`
4. If reverting an income would leave the balance negative, `UpdateAccountBalanceUseCase` throws `InsufficientFundsException` — `run()` rolls back and re-throws it as-is (never wraps). The use case catches it **outside** `run()` and translates it to `CannotDeleteTransactionException`; the rollback has already happened by the time that `catch` runs, so the translation is a decision about which exception to surface, not about the transaction's outcome.

### Read use cases

`GetTransactionByIdUseCase`, `GetTransactionsByAccountIdUseCase`, `GetTransactionsByUserIdUseCase` — no special complexity. The collection ones support pagination (`offset`, `limit`) and date-range filtering (`from`, `to`).

---

## Infrastructure layer

### `TransactionOrmEntity`

| Column | Type | Notes |
|---------|------|-------|
| `id` | `uuid` | PK, generated with `randomUUID()` in the use case |
| `userId` | `varchar` | Logical reference |
| `accountId` | `varchar` | Logical reference |
| `categoryId` | `varchar` | Logical reference |
| `nature` | `varchar` | `income` or `expense` |
| `amount` | `int` | CLP, no decimals |
| `description` | `varchar` | Nullable |
| `transactionDate` | `timestamp` | Actual date of the movement (may differ from `createdAt`) |
| `createdAt` | `timestamp` | Date it entered the system |

Composite indexes:
```
@Index('idx_tx_user_date',            ['userId', 'transactionDate'])
@Index('idx_tx_account_date',         ['accountId', 'transactionDate'])
@Index('idx_tx_user_cat_nature_date', ['userId', 'categoryId', 'nature', 'transactionDate'])
```
The third one covers the `sumExpenseAmountByUserCategoryAndPeriod` that runs on every expense create.

### `TypeOrmUnitOfWorkImpl`

**File:** `infrastructure/persistence/unit-of-work.impl.ts`

> The **pattern** (why an impl can satisfy several ports via `useExisting`, why the ports are `abstract class`, why they are counted per *atomic operation* and not per module) lives in [shared/domain/uow-decision.md](../../shared/domain/uow-decision.md) and in CLAUDE.md. This section documents only the **concrete mechanics** of this class — to avoid duplicating the "why" and having it drift again.

A concrete class that satisfies **one** module port today: `ITransactionUnitOfWork`. Since `PLAN-P3P4-transactional-runner.md` it `extends TypeOrmTransactionRunner<TransactionTxContext>` (`shared/infrastructure/persistence/typeorm-transaction-runner.ts`) and separately `implements ITransactionUnitOfWork` — valid because that port declares no members beyond the inherited `run()`. No `Scope.REQUEST`: this class has no `QueryRunner` field, so NestJS provides it as a plain singleton (`{ provide: ITransactionUnitOfWork, useClass: TypeOrmUnitOfWorkImpl }`, no `scope` at all).

It used to also `implement IBudgetUnitOfWork`, aliased via `useExisting` to the same request-scoped instance so `UpdateBudgetLimitUseCase` / `DeleteBudgetUseCase` shared this class's `QueryRunner` whenever they ran in the same request (which they never actually needed to — `CreateTransactionUseCase` is the only flow that genuinely needs a multi-aggregate `QueryRunner`). `IAccountUnitOfWork` was a third alias here before that. Both moved out the same way: `accounts` now owns `AccountUnitOfWorkImpl`, `budgets` now owns `BudgetUnitOfWorkImpl` — neither's use cases ever needed a `QueryRunner` shared with this class, and serving them from here forced their modules to import `TransactionsModule` (via `forwardRef()`, in the budgets case) just to resolve a token this class's own use cases never inject. Note what `useExisting` actually bought, back when `Scope.REQUEST` still existed — a shared `QueryRunner` **within one request**, which only `CreateTransactionUseCase` needed. Between requests it bought nothing, because `Scope.REQUEST` already yielded one instance per request; what serializes concurrent requests is the Postgres row lock, same as today.

This class still builds a scoped budget repo — `CreateTransactionUseCase` locks the budget row before summing period expenses — exposed as `ctx.budgets` (a property, not a getter, since the run() migration). It goes through `createScopedBudgetRepository()`, the same factory `BudgetUnitOfWorkImpl` calls on its own `QueryRunner`. Two independent consumers, two independent transactions, same lock semantics; see `budgets/notes.md` → "Why `budgets` does not depend on `transactions`".

#### Lifecycle: `createContext()` is the only thing this class writes

There is no mutable `queryRunner` field anymore, and no `begin`/`commit`/`rollback`/`release`/`isConnected` methods to implement — those lived on `IUnitOfWork` only during the P3+P4 migration and are gone now. `TypeOrmTransactionRunner<TransactionTxContext>` (the shared base class) owns the entire lifecycle in one `run()` method: create a `QueryRunner` from the injected `DataSource`, `connect()`, `startTransaction()`, call this class's `createContext(queryRunner)` exactly once, invoke the callback with the result, commit on a clean return, roll back on a thrown error (never masking it), and always release in a `finally`. It also wraps the context in a `Proxy` that throws if touched after `run()` returns, and detects same-chain nested `run()` calls via `AsyncLocalStorage` before opening a second `QueryRunner`.

This class's entire contribution is:

```ts
protected createContext(queryRunner: QueryRunner): TransactionTxContext {
  return {
    transactions: new ScopedTransactionRepository(queryRunner.manager, this.transactionMapper),
    accounts: createScopedAccountRepository(queryRunner, this.accountMapper),
    budgets: createScopedBudgetRepository(queryRunner, this.budgetMapper),
  };
}
```

#### The three scoped resources

`createContext()` builds the three scoped repos, all on `queryRunner.manager` (the active runner's `EntityManager`), and exposes them as read-only properties of `TransactionTxContext` — what used to be three getter method calls are now three property reads on `ctx`:

- `ctx.transactions` → `ScopedTransactionRepository`
- `ctx.accounts` → `ScopedAccountRepository`, built by `createScopedAccountRepository()` from `accounts/infrastructure/persistence/scoped-account.repository.ts`
- `ctx.budgets` → `ScopedBudgetRepository`, built by `createScopedBudgetRepository()` from `budgets/infrastructure/persistence/scoped-budget.repository.ts`

(There used to be a fourth, `ctx.expenses` / `getScopedExpenseChecker()` → `ScopedExpenseChecker`. It moved to `budgets` along with `IBudgetUnitOfWork` — its only consumers, `DeleteBudgetUseCase` and `UpdateBudgetLimitUseCase`, live there, so keeping it here was serving a port this module no longer implements.)

`ScopedTransactionRepository` is **private to this file** (not exported). The only way to obtain it is through `createContext()`, which only ever runs with an active transaction — `TypeOrmTransactionRunner.run()` guarantees that by construction, so there is no `!` non-null assertion to justify anymore (there was one, on the old `queryRunner` field, before this class stopped holding a field at all). Since all scoped repos share the same `manager`, every read and write lands in the same PostgreSQL transaction.

`ScopedAccountRepository` and `ScopedBudgetRepository` are the exceptions, and deliberately so: `accounts` and `budgets` each also need their own scoped repo for their own single-aggregate UoW (`AccountUnitOfWorkImpl`, `BudgetUnitOfWorkImpl`), so both classes live in their owning module's infrastructure — next to the aggregate whose invariant their `FOR UPDATE` protects — and are still unexported there. Every pair of UoWs that needs one reaches it through the same factory, each passing its own `QueryRunner`. The factory takes a `QueryRunner` rather than an `EntityManager` precisely so that `dataSource.manager` fails to compile; it also throws if the runner has no active transaction. Same guarantee as the private class, enforced by types instead of by file scope.

#### Locks by construction

Because they always live inside an open tx, the scoped repos' `findById` methods take `FOR UPDATE` (`lock: { mode: 'pessimistic_write' }`) without a parameter: reading a row by id here implies intent to mutate. The aggregate methods (`SUM`/`COUNT`) take **no** lock — Postgres forbids it on aggregates, and serialization comes from the `FOR UPDATE` the caller takes beforehand on the budget row. See the full map in [CLAUDE.md → Locking & serialization map](../../../CLAUDE.md) and the rationale in *Architectural decision — locks in scoped repos* below.

### `TransactionMapper`

`toDomain(orm)` — uses `TransactionNature.reconstitute()` and `Amount.reconstitute()` (doesn't re-validate already-persisted data). `Transaction.reconstitute()` to preserve timestamps.

### Routes

| Method | Route | Use case | HTTP |
|--------|------|----------|------|
| POST | `/transactions` | `CreateTransactionUseCase` | 201 |
| GET | `/transactions` | `GetTransactionsByUserIdUseCase` | 200 |
| GET | `/transactions/account/:accountId` | `GetTransactionsByAccountIdUseCase` | 200 |
| GET | `/transactions/:id` | `GetTransactionByIdUseCase` | 200 |
| DELETE | `/transactions/:id` | `DeleteTransactionUseCase` | 204 |

Exception mapping:

| Exception | HTTP |
|-----------|------|
| `TransactionNotFoundException` | 404 |
| `AccountNotFoundException` | 404 |
| `CategoryNotFoundException` | 404 |
| `IncompatibleCategoryNatureException` | 400 |
| `BudgetRequiredForExpenseTransactionException` | 409 |
| `BudgetLimitExceededException` | 422 |
| `InsufficientFundsException` | 422 |
| `CannotDeleteTransactionException` | 409 |
| `ResourceOwnershipException` | 403 |

---

## Wiring — `TransactionsModule`

Imports: `AccountsModule`, `BudgetsModule`, `CategoriesModule` — all direct imports, no `forwardRef` anywhere. Both cycles that used to exist (`accounts ↔ transactions`, `budgets ↔ transactions`) are gone; there is zero `forwardRef()` left in the module graph.
Exports: `ITransactionUnitOfWork` only. (`IBudgetUnitOfWork` used to be exported here too, aliased to this module's `TypeOrmUnitOfWorkImpl`; it is now provided and exported by `BudgetsModule`, pointing at `BudgetUnitOfWorkImpl`.)

---

## Resolved race conditions (historical)

The already-closed concurrency bugs **specific to this module** (Bug A, Bug A.2, Bug B) and their full analysis were moved to [notes-history.md](./notes-history.md).

The races that **cross modules** — Race 1 (`DELETE /budgets/:id` vs `POST /transactions`) and Race 2 (account mutations vs `POST /transactions`) — are documented centrally in [docs/history/race-conditions-fix-2026-05.md](../../../docs/history/race-conditions-fix-2026-05.md).

---

## Architectural decision — locks in scoped repos

**Decision:** the pessimistic locks live hardcoded in the `ScopedXRepository` methods inside `unit-of-work.impl.ts`. They are **not** exposed as an optional parameter or as a declarative method (`findByIdForUpdate`) on the domain interfaces.

**Reasons:**
1. The `ScopedXRepository` classes are private to the file. Only the UoW builds them and they are only used inside an active `QueryRunner`. In that context, reading by id implies intent to mutate — there is no legitimate case of reading without a lock.
2. The domain interfaces (`IAccountRepository`, `IBudgetRepository`) are not polluted with SQL concepts. They stay clean for the rest of the system.
3. It doesn't require creating parallel scoped interfaces (`IScopedAccountRepository extends IAccountRepository`) or modifying `IUnitOfWork` to return specialized types. Minimal change, maximum coverage.

**Accepted trade-off:** the flexibility of doing a lock-free read inside a transaction is lost. In this domain there is no use case for that — non-mutating reads (validation, listing) use the global repos outside the UoW.

---

## Relevant isolation concepts

**Operational rule:** the budget row is the **serialization gate** of the invariant "Σ expenses + new expense ≤ budget.limit". The whole decision must be built with data read **after** acquiring `SELECT budget FOR UPDATE` and before the UoW's `COMMIT` — that is the critical period. The gate works because the budget row always exists (unique constraint on `(user, category, month, year)` + fail-fast pre-UoW) and every flow that mutates the period (`CreateTransaction`, `UpdateBudgetLimit`, `DeleteBudget`) goes through it.

`sumExpenseAmountByUserCategoryAndPeriod` (the scoped version in the UoW) takes **no** `FOR UPDATE`. It wouldn't help: a `FOR UPDATE` on a range `WHERE` only locks the existing matching rows; it doesn't prevent concurrent inserts in the range (phantoms). The only reliable lock is the budget's. The equivalent versions in `ScopedExpenseChecker` (`hasExpensesInPeriod`, `sumExpenseAmountInPeriod`) take **no** `FOR UPDATE` either — for the same reason, and additionally Postgres forbids pessimistic locks on aggregates (`COUNT`/`SUM`). Their consistency is guaranteed by the budget-row lock that `UpdateBudgetLimitUseCase` and `DeleteBudgetUseCase` acquire **before** invoking them.

Postgres's default is `READ COMMITTED`. Within the same transaction, two reads of the same row can see different values if another commit happened in between ("non-repeatable reads"). `SERIALIZABLE` would detect the conflict at commit time and abort with `40001` — it would require retries in the application.

---

## Resources

- Book: **DDIA** ch. 7 "Transactions" — lost update (§7.1), write skew (§7.2)
- Article: postgresql.org/docs → "Explicit Locking"
- Article: Use-The-Index-Luke.com — to understand the composite indexes
