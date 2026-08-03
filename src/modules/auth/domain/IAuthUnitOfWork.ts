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
 * Puerto UoW propio del módulo auth. Extiende IUnitOfWork genérico; no
 * declara miembros propios más allá de `run()` — `ctx.refreshTokens` (una
 * propiedad de `AuthTxContext`) es lo que `RefreshTokenUseCase` usa para
 * revocar + crear en una transacción atómica, reemplazando lo que antes era
 * un getter `getRefreshTokenRepository()` en este puerto.
 */
export abstract class IAuthUnitOfWork extends IUnitOfWork<AuthTxContext> {}
