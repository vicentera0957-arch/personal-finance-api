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

**File:** `domain/repository/expense-checker.port.ts`

Defined here (consumer owns the port). Implemented in `transactions/infrastructure/persistence/expense-checker.implement.ts`. Exported by `TransactionsModule`.

Methods: `hasExpensesInPeriod(userId, categoryId, month, year): Promise<boolean>` and `sumExpenseAmountInPeriod(...): Promise<number>`. **Neither takes `FOR UPDATE`** (Postgres forbids pessimistic locks on `COUNT`/`SUM` aggregates); serialization comes from the lock on the budget row that the consumer (`DeleteBudget` / `UpdateBudgetLimit`) acquires first.

---

## Application layer

| Use case                               | Flow                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `CreateBudgetUseCase`                  | Validates category (`nature === 'expense'`) → persists → `catch 23505` → `BudgetAlreadyExistsException` |
| `GetBudgetByIdUseCase`                 | Finds → validates ownership → throws `BudgetNotFoundException`                                          |
| `GetBudgetsByUserIdUseCase`            | Filters by userId (and optionally month/year)                                                      |
| `GetBudgetByUserCategoryPeriodUseCase` | Internal lookup for `CreateTransactionUseCase`                                                    |
| `UpdateBudgetLimitUseCase`             | Opens UoW → `findById` budget (FOR UPDATE) → validates ownership → sums the period's expenses (no own lock; serialized by the budget lock) → if `new limit < spent` throws `BudgetLimitBelowSpentException` (409) → commit |
| `DeleteBudgetUseCase`                  | Opens UoW → `findById` budget (FOR UPDATE) → validates ownership → `hasExpensesInPeriod` (no own lock; serialized by the budget lock) → deletes if there are no expenses |

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

Imports `TransactionsModule` (with `forwardRef`) to obtain `IExpenseChecker`.
Exports: `GetBudgetByUserCategoryPeriodUseCase` — consumed by `CreateTransactionUseCase`.

---

## Dependency inversion: the `budgets ↔ transactions` cycle

Problem: `transactions` needs `budgets` to validate R8. `budgets` needs to know whether transactions exist to validate the delete. Without care, a `budgets → transactions → budgets` cycle.

"Port owned by consumer" solution:

```
budgets/domain/repository/expense-checker.port.ts   ← defines the port
transactions/infrastructure/persistence/expense-checker.implement.ts  ← implements
transactions.module.ts: exports IExpenseChecker
budgets.module.ts:      imports forwardRef(() => TransactionsModule)
```

The `forwardRef()` is an artifact of NestJS's DI graph. The dependency direction in the DOMAIN is clean: `transactions` depends on `budgets` (for the budget lookup); `budgets` defines the port that `transactions` implements.

---

## Race status (historical)

Moved to [notes-history.md](./notes-history.md): the "check-then-insert" race in `CreateBudget` (closed with `@Unique` + `catch 23505`) and the **Bug A** write skew. The races that cross modules (Race 1: `DELETE /budgets/:id` vs `POST /transactions`) are in [docs/history/race-conditions-fix-2026-05.md](../../../docs/history/race-conditions-fix-2026-05.md).

---

## Resources

- Book: DDIA §7.2 "Write Skew and Phantoms"
- Article: postgresql.org/docs → "Transaction Isolation"
- Article: SOLID "D" — Dependency Inversion Principle
