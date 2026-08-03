import { IUnitOfWork } from '../../../shared/domain/IUnitOfWork';
import { IRefreshTokenRepository } from './repository/refresh-token.repository';

/**
 * Recursos escopados que `run()` entrega dentro de una transacción de
 * `IAuthUnitOfWork`. `interface`, no `abstract class` — ver
 * `TransactionTxContext` / el docblock de `IUnitOfWork` para el porqué.
 */
export interface AuthTxContext {
  readonly refreshTokens: IRefreshTokenRepository;
}

/**
 * Puerto UoW propio del módulo auth.
 * Extiende IUnitOfWork genérico y expone el repo de refresh tokens
 * para que RefreshTokenUseCase pueda revocar + crear en una transacción atómica.
 */
export abstract class IAuthUnitOfWork extends IUnitOfWork<AuthTxContext> {
  abstract getRefreshTokenRepository(): IRefreshTokenRepository;
}
