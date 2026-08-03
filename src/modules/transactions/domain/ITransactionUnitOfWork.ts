import { IUnitOfWork } from '../../../shared/domain/IUnitOfWork';
import { IScopedTransactionRepository } from './repository/scoped-transaction.repository';
import { IAccountRepository } from '../../accounts/domain/repository/accounts.repository';
import { IBudgetRepository } from '../../budgets/domain/repository/budgets.repository';

/**
 * Recursos escopados que `run()` entrega dentro de una transacción de
 * `ITransactionUnitOfWork`. `interface`, no `abstract class`: nunca se
 * inyecta — es sólo el tipo del parámetro de callback de `run()` (misma
 * categoría que `CreateTransactionCommand`). Ver el docblock de
 * `IUnitOfWork` para por qué esto no viola la regla de puertos = `abstract
 * class`.
 */
export interface TransactionTxContext {
  readonly transactions: IScopedTransactionRepository;
  readonly accounts: IAccountRepository;
  readonly budgets: IBudgetRepository;
}

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
export abstract class ITransactionUnitOfWork extends IUnitOfWork<TransactionTxContext> {
  abstract getScopedTransactionRepository(): IScopedTransactionRepository;
  abstract getScopedAccountRepository(): IAccountRepository;
  abstract getScopedBudgetRepository(): IBudgetRepository;
}
