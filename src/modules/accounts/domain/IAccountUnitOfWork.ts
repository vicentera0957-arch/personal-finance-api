import { IUnitOfWork } from '../../../shared/domain/IUnitOfWork';
import { IScopedAccountRepository } from './repository/scoped-account.repository';

/**
 * Recursos escopados que `run()` entrega dentro de una transacción de
 * `IAccountUnitOfWork`. `interface`, no `abstract class` — ver
 * `TransactionTxContext` / el docblock de `IUnitOfWork` para el porqué.
 *
 * `IScopedAccountRepository`, no `IAccountRepository` (P5): ni Archive,
 * Unarchive ni Rename necesitan `findByUserId` ni `delete` bajo lock.
 */
export interface AccountTxContext {
  readonly accounts: IScopedAccountRepository;
}

/**
 * No members beyond the inherited `run()`: `ctx.accounts` (a property of
 * `AccountTxContext`) replaces what used to be a
 * `getScopedAccountRepository()` getter on this port.
 */
export abstract class IAccountUnitOfWork extends IUnitOfWork<AccountTxContext> {}
