# `transactions` module — History and post-mortems

> Record of already **closed** concurrency bugs, kept so future contributors don't redo the analysis. The module's **current** state lives in [notes.md](./notes.md).
>
> The races that **cross modules** — Race 1 (`DELETE /budgets/:id` vs `POST /transactions`) and Race 2 (account mutations vs `POST /transactions`) — are documented centrally in [docs/history/race-conditions-fix-2026-05.md](../../../../docs/history/race-conditions-fix-2026-05.md). Only the bugs whose analysis belongs to `transactions` live here.

---

## Resolved race conditions (April 2026)

### Bug A — Write skew on the budget limit (RESOLVED)

**Original scenario:** the user had a budget limit=$100 and had spent $80.
1. `PATCH /budgets/X/limit` → `UpdateBudgetLimitUseCase` opened the UoW, read the budget without a lock, changed the limit to $60, committed.
2. Simultaneously: `POST /transactions` expense $20 → read the budget OUTSIDE the UoW (line ~111 used the global `getBudgetByUserCategoryPeriodUseCase`, not the scoped repo) → saw limit=$100 → $80+$20=100 ≤ 100 → inserted.
3. Result: the user spent $100 but the limit was $60. R8 violated.

**Affected files:** `create-transaction.use-case.ts` (second budget read) and `unit-of-work.impl.ts` (`ScopedBudgetRepository.findById` and `findByUserIdAndCategoryIdAndPeriod`).

**Applied solution:**
1. The second budget read in `CreateTransactionUseCase` was moved **inside** the UoW: it now uses `uow.getBudgetRepository().findByUserIdAndCategoryIdAndPeriod(...)` instead of the global use case. This read now travels through the active `QueryRunner` and participates in the same PG transaction.
2. `ScopedBudgetRepository.findByUserIdAndCategoryIdAndPeriod` added `lock: { mode: 'pessimistic_write' }` → emits `SELECT ... FOR UPDATE`.
3. `ScopedBudgetRepository.findById` added the same lock → also protects the `UpdateBudgetLimitUseCase` side.

**Why it works:** both flows (`CreateTransaction` and `UpdateBudgetLimit`) now compete for the same row lock on the budget. PostgreSQL serializes: the second arrival waits for the first one's COMMIT before reading, guaranteeing that the limit it sees is the current one.

### Bug A.2 — Stale sum vs phantom inserts in an empty period (RESOLVED)

**Original scenario (post Bug A):** two concurrent `POST /transactions` expenses on an **empty** period (no prior spend). The flow was `SUM FOR UPDATE` → `SELECT budget FOR UPDATE` → validate → insert.

1. TX A runs `SUM ... FOR UPDATE` over 0 rows → sum=0. **`FOR UPDATE` over an empty resultset locks nothing** (there are no rows to lock; phantoms aren't prevented).
2. TX B runs `SUM ... FOR UPDATE` over 0 rows → sum=0. Also locks nothing.
3. TX A takes `SELECT budget FOR UPDATE`, validates `0 + 60 ≤ 100` OK, inserts, COMMIT.
4. TX B waits on the budget lock, wakes up, validates with the **stale** `sum=0` it read in (2), `0 + 60 ≤ 100` OK, inserts, COMMIT.
5. Real total $120 > $100. R8 violated.

**Why the original test didn't catch it:** it started from $90 already spent → the `SUM`'s `FOR UPDATE` grabbed real rows and serialized **by luck**. The correctness must not depend on the state of the data.

**Affected files:** `create-transaction.use-case.ts` (order of operations inside the UoW) and `unit-of-work.impl.ts` (`ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod`).

**Applied solution:**
1. **Reorder** the expense block in `CreateTransactionUseCase`: first `budgetRepo.findByUserIdAndCategoryIdAndPeriod(...)` (the gate), then `txRepo.sumExpenseAmountByUserCategoryAndPeriod(...)`.
2. **Remove** the redundant `setLock('pessimistic_write')` from `ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod`. With the budget gate, that lock adds no correctness and does add contention with concurrent reads.
3. Regression test in `test/integration/concurrency/concurrency.integration.spec.ts` that reproduces the empty-period scenario.

**Why it works:** once the budget row is the mutex, two competing TXs serialize on the `SELECT budget FOR UPDATE`. The one that wakes up second runs its `SUM` as a **new statement** post-COMMIT of the winner; in `READ COMMITTED` that statement sees the data committed at the moment it executes, so the `sum` includes the winner's INSERT. The invariant is validated with fresh data without needing to raise to `SERIALIZABLE`.

**Pattern:** `UpdateBudgetLimitUseCase` already applied it (budget lock first, then recompute the sum). This change aligns `CreateTransaction` with the same pattern. The generalized rule: **any data that feeds the invariant's decision must be read after acquiring the gate's lock**.

### Bug B — Lost update on the account balance (RESOLVED)

**Original scenario:** two concurrent `POST /transactions` requests on the same account.
1. TX1 read `account.balance = $1000` (no lock)
2. TX2 read `account.balance = $1000` (no lock)
3. TX1 computed $1000 + $500 = $1500, wrote
4. TX2 computed $1000 - $300 = $700, wrote → **TX1's $500 were lost**

**Affected file:** `unit-of-work.impl.ts` — `ScopedAccountRepository.findById` used `manager.findOne` without a lock.

**Applied solution:** `ScopedAccountRepository.findById` added `lock: { mode: 'pessimistic_write' }` → emits `SELECT ... FOR UPDATE`.

**Why it works without touching `UpdateAccountBalanceUseCase`:** that use case (in `accounts/application/`) is agnostic to the repo's mechanism. It receives `IAccountRepository` and calls `findById` — when the UoW injects the scoped repo, it inherits the lock automatically. Good separation of responsibilities: the accounts domain doesn't need to know about SQL transactions.
