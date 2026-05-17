import { Injectable } from '@nestjs/common';
import { ITokenProvider } from '../../domain/ports/token-provider.port';
import { IRefreshTokenRepository } from '../../domain/repository/refresh-token.repository';
import { InvalidRefreshTokenException } from '../../domain/exceptions/auth.exceptions';
import { sha256 } from '../utils/token-hash.util';

@Injectable()
export class LogoutUseCase {
  constructor(
    private readonly tokenProvider: ITokenProvider,
    private readonly refreshTokenRepo: IRefreshTokenRepository,
  ) {}

  async execute(rawToken: string): Promise<void> {
    // Verifica firma JWT antes de buscar en DB — evita queries innecesarios.
    try {
      await this.tokenProvider.verifyRefreshToken(rawToken);
    } catch {
      throw new InvalidRefreshTokenException();
    }

    const tokenHash = sha256(rawToken);
    const stored = await this.refreshTokenRepo.findByTokenHash(tokenHash);

    if (!stored) throw new InvalidRefreshTokenException();

    // Idempotente: si ya está revocado, no hay nada que hacer.
    if (stored.isRevoked()) return;

    stored.revoke();
    await this.refreshTokenRepo.save(stored);
  }
}
