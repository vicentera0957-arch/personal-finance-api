import { IUnitOfWork } from '../../../shared/domain/IUnitOfWork';
import { ITransactionRepository } from './repository/transaction.repository';
import { IAccountRepository } from '../../accounts/domain/repository/accounts.repository';
import { IBudgetRepository } from '../../budgets/domain/repository/budgets.repository';

/**
 * Transactions-scoped Unit of Work.
 *
 * Used by `CreateTransactionUseCase` and `DeleteTransactionUseCase`, which
 * need to atomically coordinate writes across the `transactions`, `accounts`
 * and `budgets` aggregates inside a single PostgreSQL transaction.
 *
 * The repository getters return SCOPED repositories that all share the same
 * `EntityManager` (and therefore the same QueryRunner / DB connection),
 * which is what makes pessimistic locks (`FOR UPDATE`) effective across
 * the full sequence of reads + writes.
 */
export abstract class ITransactionUnitOfWork extends IUnitOfWork {
  abstract getScopedTransactionRepository(): ITransactionRepository;
  abstract getScopedAccountRepository(): IAccountRepository;
  abstract getScopedBudgetRepository(): IBudgetRepository;
}
