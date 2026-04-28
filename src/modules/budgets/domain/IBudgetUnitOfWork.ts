import { IUnitOfWork } from '../../../shared/domain/IUnitOfWork';
import { IBudgetRepository } from './repository/budgets.repository';

/**
 * Budgets-scoped Unit of Work.
 *
 * Used by `UpdateBudgetLimitUseCase`, which needs to take a pessimistic
 * lock on the budget row and update it inside a single transaction so that
 * concurrent `POST /transactions` cannot read the old limit between the
 * SELECT and the UPDATE.
 *
 * Exposes only `getBudgetRepository()` because that is the only aggregate
 * this module mutates transactionally. The same concrete implementation
 * (`TypeOrmUnitOfWorkImpl`) satisfies this port and `ITransactionUnitOfWork`
 * via `useExisting`, so a single QueryRunner per request is shared.
 */
export abstract class IBudgetUnitOfWork extends IUnitOfWork {
  abstract getBudgetRepository(): IBudgetRepository;
}
