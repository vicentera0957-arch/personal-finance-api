import { IUnitOfWork } from '../../../shared/domain/IUnitOfWork';
import { IBudgetRepository } from './repository/budgets.repository';
import { IExpenseChecker } from './ports/expense-checker.port';

/**
 * Recursos escopados que `run()` entrega dentro de una transacción de
 * `IBudgetUnitOfWork`. `interface`, no `abstract class` — ver
 * `TransactionTxContext` / el docblock de `IUnitOfWork` para el porqué.
 */
export interface BudgetTxContext {
  readonly budgets: IBudgetRepository;
  readonly expenses: IExpenseChecker;
}

/**
 * No members beyond the inherited `run()`: `ctx.budgets` / `ctx.expenses`
 * (properties of `BudgetTxContext`) replace what used to be
 * `getScopedBudgetRepository()` / `getScopedExpenseChecker()` getters on
 * this port.
 */
export abstract class IBudgetUnitOfWork extends IUnitOfWork<BudgetTxContext> {}
