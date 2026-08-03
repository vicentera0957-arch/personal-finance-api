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

export abstract class IAccountUnitOfWork extends IUnitOfWork<AccountTxContext> {
  abstract getScopedAccountRepository(): IAccountRepository;
}
