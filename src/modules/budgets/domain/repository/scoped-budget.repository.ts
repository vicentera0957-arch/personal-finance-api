import { Budget } from '../budget.entity';

// Command-side port: the budget surface budgets' OWN UoW uses INSIDE an open
// transaction (UpdateBudgetLimit, DeleteBudget). It is never a DI token — the
// UoW's createContext() constructs the scoped implementation and hands it out
// as `ctx.budgets`.
//
// `transactions` (CreateTransaction) does NOT get this port — it only reads
// the budget row by (user, category, period), never by id, and never writes
// it. That capability lives in the sibling port `IScopedBudgetPeriodReader`.
export abstract class IScopedBudgetRepository {
  abstract findByIdWithLock(id: string): Promise<Budget | null>;
  abstract save(budget: Budget): Promise<Budget>;
  abstract delete(id: string): Promise<void>;
}
