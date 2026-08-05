import { IUnitOfWork } from '../../../shared/domain/IUnitOfWork';
import { IScopedTransactionRepository } from './repository/scoped-transaction.repository';
import { IScopedAccountRepository } from '../../accounts/domain/repository/scoped-account.repository';
import { IScopedBudgetPeriodReader } from '../../budgets/domain/repository/budget-period-reader.port';

/**
 * Recursos escopados que `run()` entrega dentro de una transacción de
 * `ITransactionUnitOfWork`. `interface`, no `abstract class`: nunca se
 * inyecta — es sólo el tipo del parámetro de callback de `run()` (misma
 * categoría que `CreateTransactionCommand`). Ver el docblock de
 * `IUnitOfWork` para por qué esto no viola la regla de puertos = `abstract
 * class`.
 *
 * `accounts: IScopedAccountRepository` y `budgetPeriodReader:
 * IScopedBudgetPeriodReader` (P5, PLAN-P5-narrow-ports.md §2): transactions
 * escribe el balance de la cuenta (parte del invariante multi-agregado que
 * ancla), pero NUNCA borra una cuenta ni escribe/borra un budget — sólo lee
 * el límite. `budgetPeriodReader`, no `budgets`: el nombre deja de sugerir
 * que este puerto puede escribir presupuestos.
 */
export interface TransactionTxContext {
  readonly transactions: IScopedTransactionRepository;
  readonly accounts: IScopedAccountRepository;
  readonly budgetPeriodReader: IScopedBudgetPeriodReader;
}

/**
 * Transactions-scoped Unit of Work.
 *
 * Used by `CreateTransactionUseCase` and `DeleteTransactionUseCase`, which
 * need to atomically coordinate writes across the `transactions`, `accounts`
 * and `budgets` aggregates inside a single PostgreSQL transaction.
 *
 * No members beyond the inherited `run()`: the scoped repositories used to
 * be exposed as getters (`getScopedTransactionRepository()`, etc.) on the
 * port itself; now they are properties of `TransactionTxContext`, handed to
 * `run()`'s callback. All three share the same `EntityManager` (and
 * therefore the same QueryRunner / DB connection), which is what makes
 * pessimistic locks (`FOR UPDATE`) effective across the full sequence of
 * reads + writes.
 */
export abstract class ITransactionUnitOfWork extends IUnitOfWork<TransactionTxContext> {}
