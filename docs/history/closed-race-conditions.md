# Closed race conditions

Kept so future contributors don't redo the analysis. **All currently closed.** Moved out of
`CLAUDE.md` because it is a historical record, not guidance a session needs loaded on every turn —
the live rules it produced are in the locking & serialization map under "Concurrency" there.

| ID     | Scenario                                                                      | How it was closed                                                                                                                                                                                          |
| ------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bug A  | `PATCH /budgets/:id/limit` racing `POST /transactions` (write skew on limit)  | `ScopedBudgetRepository.findById` and `findByUserIdAndCategoryIdAndPeriod` take `FOR UPDATE`. `CreateTransaction` reads the budget through the scoped repo, not the global use case.                       |
| Bug B  | Two concurrent `POST /transactions` on the same account (lost balance update) | `ScopedAccountRepository.findById` takes `FOR UPDATE`.                                                                                                                                                     |
| Bug E  | Two concurrent `POST /auth/register` with same email returned 500             | `UserRepositoryImpl.save()` catches `QueryFailedError` 23505 → `UserAlreadyExistsException` → 409.                                                                                                         |
| Race 1 | `DELETE /budgets/:id` racing `POST /transactions` (TOCTOU outside DB tx)      | `DeleteBudget` runs inside `IBudgetUnitOfWork`; `getScopedExpenseChecker().hasExpensesInPeriod` runs under the same `QueryRunner`, serialized by the budget-row `FOR UPDATE` taken first.                                                                |
| Race 2 | `PATCH /accounts/:id/{archive,unarchive,name}` racing transaction mutations   | All three rewritten to inject `IAccountUnitOfWork`; `findById` takes `FOR UPDATE` and competes with `CreateTransaction`/`DeleteTransaction`.                                                               |
| Race 3 | Two concurrent `DELETE /transactions/:id` (double-reverse balance)            | `ScopedTransactionRepository.findByIdWithLock` takes `FOR UPDATE`. `DeleteTransactionUseCase` does fail-fast outside UoW (cheap 404/403) then re-fetches inside UoW. Second arrival sees null after first commits. |
| B4     | `PATCH /budgets/:id/limit` could lower limit below already-spent amount       | `UpdateBudgetLimitUseCase` sums period expenses (`ScopedExpenseChecker.sumExpenseAmountInPeriod`, no own lock) under the budget-row `FOR UPDATE` and throws `BudgetLimitBelowSpentException` (→ 409) when `new limit < spent`.         |

The regression net for all seven is `test/integration/concurrency/concurrency.integration.spec.ts`.
Treat that file as the oracle: if you change the lock model, those scenarios must still pass
**unmodified**.

> Caveat worth knowing before trusting any single scenario there: the Race 2 assertions are looser
> than they look. If the account-side `FOR UPDATE` vanished, the typical interleaving still produces
> the statuses and balance the test accepts. The hard detectors for the account row lock are the
> N-concurrent-inflows and same-account/different-budget scenarios.
