import { IUnitOfWork } from '../../../shared/domain/IUnitOfWork';
import { IRefreshTokenRepository } from './repository/refresh-token.repository';

/**
 * Puerto UoW propio del módulo auth.
 * Extiende IUnitOfWork genérico y expone el repo de refresh tokens
 * para que RefreshTokenUseCase pueda revocar + crear en una transacción atómica.
 */
export abstract class IAuthUnitOfWork extends IUnitOfWork {
  abstract getRefreshTokenRepository(): IRefreshTokenRepository;
}
