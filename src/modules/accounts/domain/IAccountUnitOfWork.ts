import { IUnitOfWork } from '../../../shared/domain/IUnitOfWork';
import { IAccountRepository } from './repository/accounts.repository';

/**
 * Recursos escopados que `run()` entrega dentro de una transacción de
 * `IAccountUnitOfWork`. `interface`, no `abstract class` — ver
 * `TransactionTxContext` / el docblock de `IUnitOfWork` para el porqué.
 */
export interface AccountTxContext {
  readonly accounts: IAccountRepository;
}

/**
 * No members beyond the inherited `run()`: `ctx.accounts` (a property of
 * `AccountTxContext`) replaces what used to be a
 * `getScopedAccountRepository()` getter on this port.
 */
export abstract class IAccountUnitOfWork extends IUnitOfWork<AccountTxContext> {}
