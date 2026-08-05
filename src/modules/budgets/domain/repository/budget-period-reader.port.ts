import { Budget } from '../budget.entity';

// Read-only port: the ONLY budget capability `transactions` (CreateTransaction)
// needs inside its own multi-aggregate transaction — locking the period's
// budget row before summing period expenses. It is never a DI token — the
// UoW's createContext() constructs the scoped implementation and hands it out
// as `ctx.budgetPeriodReader`.
//
// Named apart from `IBudgetRepository.findByUserIdAndCategoryIdAndPeriod`
// (unlocked, global) on purpose: same data, different discipline, so the
// method name (`…WithLock`) makes the lock visible at every call site.
// `transactions` never gets `save`/`delete` on a budget — it doesn't own that
// aggregate.
export abstract class IScopedBudgetPeriodReader {
  abstract findByUserIdAndCategoryIdAndPeriodWithLock(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<Budget | null>;
}
