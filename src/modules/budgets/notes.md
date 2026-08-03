# `budgets` module — Current reference

## Concept

A **budget** is a monthly spending limit: "Food, April 2026, at most $200,000". The app prevents the user from exceeding the limit when creating expense transactions.

Key fields:

- `(userId, categoryId, month, year)` — unique 4-tuple enforced at the DB level
- `limit` — `AmountLimit` VO, positive integer

---

## Domain

### `AmountLimit` value object

**File:** `domain/amountlimit.vo.ts`

Positive integer representing the spending limit. Validations: finite, integer, greater than zero.

### `Budget` entity

Private constructor. Two factory methods (`create`, `reconstitute`).

Properties: `id`, `userId`, `categoryId`, `month`, `year`, `limit` (`AmountLimit`), `createdAt`, `updatedAt`.

Business method: `updateLimit(newLimit: AmountLimit)` — replaces the limit.

### Invariants

- **R3** — a budget is unique per `(userId, categoryId, month, year)`. Enforced with `@Unique` on `BudgetOrmEntity` + migration `1745366400000-AddBudgetUniqueConstraint.ts`.
- **R4** — the budget's category must have `nature === 'expense'`. Budgetability is **derived from `nature`** (there is no `isBudgetable` flag). Validated in `CreateBudgetUseCase` → `BudgetCategoryMustBeExpenseException`.
- **R8** (crossed with transactions) — an expense transaction requires a budget for the period and cannot exceed its `limit`. Validated in `CreateTransactionUseCase`.
- A budget cannot be deleted if expense transactions exist in its period. Enforced via the `IExpenseChecker` port.

### Domain exceptions

| Exception                                      | HTTP |
| ---------------------------------------------- | ---- |
| `BudgetNotFoundException`                      | 404  |
| `ResourceOwnershipException` (shared)          | 403  |
| `BudgetAlreadyExistsException`                 | 409  |
| `BudgetLimitExceededException`                 | 422  |
| `BudgetLimitBelowSpentException`               | 409  |
| `BudgetRequiredForExpenseTransactionException` | 409  |
| `BudgetCategoryMustBeExpenseException`         | 409  |
| `BudgetHasTransactionsInPeriodException`       | 409  |

### `IExpenseChecker` port

**File:** `domain/ports/expense-checker.port.ts` (moved out of `domain/repository/`: it answers a derived query about a period — a `boolean`, a `number` — not an aggregate's persistence lifecycle, so it doesn't belong next to `budgets.repository.ts`. Flat under `ports/`, not `ports/query/`: `ports/cache/` groups by adapter technology, and a single domain query port doesn't warrant its own subfolder yet.)

Defined here, and — as of the `IBudgetUnitOfWork` split — implemented here too: `ScopedExpenseChecker` in `infrastructure/persistence/scoped-expense-checker.ts`, unexported, reached only through `createScopedExpenseChecker(queryRunner)`. Served by `BudgetUnitOfWorkImpl.getScopedExpenseChecker()`. `transactions` does not import this port at all.

Methods: `hasExpensesInPeriod(userId, categoryId, month, year): Promise<boolean>` and `sumExpenseAmountInPeriod(...): Promise<number>`. **Neither takes `FOR UPDATE`** (Postgres forbids pessimistic locks on `COUNT`/`SUM` aggregates); serialization comes from the lock on the budget row that the consumer (`DeleteBudget` / `UpdateBudgetLimit`) acquires first, inside the same `BudgetUnitOfWorkImpl` transaction.

---

## Application layer

| Use case                               | Flow                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `CreateBudgetUseCase`                  | Validates category (`nature === 'expense'`) → persists → `catch 23505` → `BudgetAlreadyExistsException` |
| `GetBudgetByIdUseCase`                 | Finds → validates ownership → throws `BudgetNotFoundException`                                          |
| `GetBudgetsByUserIdUseCase`            | Filters by userId (and optionally month/year)                                                      |
| `GetBudgetByUserCategoryPeriodUseCase` | Internal lookup for `CreateTransactionUseCase`                                                    |
| `UpdateBudgetLimitUseCase`             | Opens UoW → `findById` budget (FOR UPDATE) → validates ownership → sums the period's expenses (no own lock; serialized by the budget lock) → if `new limit < spent` throws `BudgetLimitBelowSpentException` (409) → commit → cache invalidation best-effort (outside the tx's error scope) |
| `DeleteBudgetUseCase`                  | Opens UoW → `findById` budget (FOR UPDATE) → validates ownership → `hasExpensesInPeriod` (no own lock; serialized by the budget lock) → deletes if there are no expenses → cache invalidation best-effort (outside the tx's error scope) |

---

## Infrastructure layer

### `BudgetOrmEntity`

| Column                    | Type        | Notes             |
| ------------------------- | ----------- | ----------------- |
| `id`                      | `uuid`      | PK                |
| `userId`                  | `varchar`   |                   |
| `categoryId`              | `varchar`   |                   |
| `month`                   | `int`       | 1-12              |
| `year`                    | `int`       |                   |
| `limit`                   | `int`       | CLP               |
| `createdAt` / `updatedAt` | `timestamp` | Plain `@Column`s  |

`@Unique(['userId', 'categoryId', 'month', 'year'])` — constraint on the entity.

### `BudgetRepositoryImpl`

`save()` catches `QueryFailedError` with `code === '23505'` → throws `BudgetAlreadyExistsException`. This closes the "check-then-insert" race condition at the DB level.

### Routes

| Method | Route                | Use case                    | HTTP |
| ------ | -------------------- | --------------------------- | ---- |
| POST   | `/budgets`           | `CreateBudgetUseCase`       | 201  |
| GET    | `/budgets`           | `GetBudgetsByUserIdUseCase` | 200  |
| GET    | `/budgets/:id`       | `GetBudgetByIdUseCase`      | 200  |
| PATCH  | `/budgets/:id/limit` | `UpdateBudgetLimitUseCase`  | 200  |
| DELETE | `/budgets/:id`       | `DeleteBudgetUseCase`       | 204  |

---

## Wiring — `BudgetsModule`

Imports only `CategoriesModule` (itself a leaf) — `budgets` is a leaf module. It owns its own transactional boundary:

```ts
{ provide: BudgetUnitOfWorkImpl, useClass: BudgetUnitOfWorkImpl, scope: Scope.REQUEST }
{ provide: IBudgetUnitOfWork,    useExisting: BudgetUnitOfWorkImpl }
```

Exports: `GetBudgetByUserCategoryPeriodUseCase`, `BudgetMapper` — consumed by `TransactionsModule` (a direct import there now, no `forwardRef`).

---

## Why `budgets` does not depend on `transactions` (historical: the cycle that used to exist here)

Until the `IBudgetUnitOfWork` split, `budgets` needed two things from `transactions`: the `IBudgetUnitOfWork` transactional boundary itself, and `IExpenseChecker` (an answer to "are there expenses in this period, and how much?", needed by `DeleteBudget` / `UpdateBudgetLimit`). Both were implemented inside `transactions/infrastructure/persistence/unit-of-work.impl.ts`, reached from `budgets.module.ts` via `forwardRef(() => TransactionsModule)` — the "port owned by consumer" pattern:

```
budgets/domain/repository/expense-checker.port.ts       ← defined the port (now domain/ports/, see below)
transactions/infrastructure/persistence/unit-of-work.impl.ts (ScopedExpenseChecker) ← implemented it
budgets/domain/IBudgetUnitOfWork.ts                      ← defined this port too
transactions/infrastructure/persistence/unit-of-work.impl.ts (TypeOrmUnitOfWorkImpl) ← implemented it too
budgets.module.ts:      imported forwardRef(() => TransactionsModule)
```

(`expense-checker.port.ts` moved a second time, independently of this cycle fix: from `domain/repository/` to `domain/ports/`, since it answers a derived query rather than modeling an aggregate's persistence lifecycle — see the `IExpenseChecker` port section above.)

Neither port actually needed anything `transactions`-specific: `UpdateBudgetLimit` and `DeleteBudget` only ever needed a transaction, a `FOR UPDATE` on the budget row, and one aggregate read under that lock — all scoped to the budget aggregate. So instead of keeping the cross-module split, both implementations (`ScopedExpenseChecker`, `BudgetUnitOfWorkImpl`) moved into `budgets/infrastructure/persistence/`, next to the ports they serve. `budgets` no longer imports `transactions`; `forwardRef()` is gone from the whole module graph.

The one piece that stayed genuinely shared is `ScopedBudgetRepository`: `CreateTransactionUseCase` still locks the budget row (on `TypeOrmUnitOfWorkImpl`'s own `QueryRunner`) before summing period expenses, independent of `UpdateBudgetLimit` / `DeleteBudget` locking it (on `BudgetUnitOfWorkImpl`'s own `QueryRunner`). So `ScopedBudgetRepository` took the shape `ScopedAccountRepository` already used: unexported class, reached only via `createScopedBudgetRepository(queryRunner, mapper)`, called independently by both UoWs, each on its own transaction. `transactions → budgets` remains as a plain one-way import (`GetBudgetByUserCategoryPeriodUseCase`, `BudgetMapper`, and the scoped-repository factory).

---

## Race status (historical)

Moved to [notes-history.md](./notes-history.md): the "check-then-insert" race in `CreateBudget` (closed with `@Unique` + `catch 23505`) and the **Bug A** write skew. The races that cross modules (Race 1: `DELETE /budgets/:id` vs `POST /transactions`) are in [docs/history/race-conditions-fix-2026-05.md](../../../docs/history/race-conditions-fix-2026-05.md).

---

## Resources

- Book: DDIA §7.2 "Write Skew and Phantoms"
- Article: postgresql.org/docs → "Transaction Isolation"
- Article: SOLID "D" — Dependency Inversion Principle
