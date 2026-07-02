# `budgets` module — History and post-mortems

> Races/bugs closed with budgets-specific analysis. The **current** state lives in [notes.md](./notes.md).

---

## "Check-then-insert" race in CreateBudget — CLOSED

**Previous state:** `CreateBudgetUseCase` did check + insert with no atomicity guarantee — two simultaneous requests could both pass the check and create duplicates of the same `(userId, categoryId, month, year)`.

**Current state:** `@Unique(['userId', 'categoryId', 'month', 'year'])` on `BudgetOrmEntity` + migration `1745366400000` + `catch 23505` in `BudgetRepositoryImpl.save()` → returns 409 (`BudgetAlreadyExistsException`) instead of 500.

---

## Bug A — Write skew in UpdateBudgetLimit vs CreateTransaction — RESOLVED

Anchored to `CreateTransaction`. The full analysis (scenario, fix, why it works) lives in [transactions/notes-history.md](../transactions/notes-history.md), because the main correction is in `create-transaction.use-case.ts` and `unit-of-work.impl.ts`.

**Summary from the budgets side:** both flows (`UpdateBudgetLimit` and `CreateTransaction`) now compete for the same budget row lock. `ScopedBudgetRepository.findById` and `findByUserIdAndCategoryIdAndPeriod` take `FOR UPDATE`; the second budget read in `CreateTransaction` was moved inside the UoW. Postgres serializes: the second arrival waits for the first one's COMMIT and reads the current limit.

---

## Race 1 — DELETE /budgets/:id vs POST /transactions (cross-cutting)

Documented centrally in [docs/history/race-conditions-fix-2026-05.md](../../../docs/history/race-conditions-fix-2026-05.md).

In short: `DeleteBudgetUseCase` runs inside `IBudgetUnitOfWork`; `ScopedBudgetRepository.findById` takes `FOR UPDATE` and `getScopedExpenseChecker().hasExpensesInPeriod` runs under the same `QueryRunner`. The budget row acts as a mutex: whoever wins the lock completes their critical section atomically, and the loser either sees the budget deleted (404) or sees expenses in the period (409).
