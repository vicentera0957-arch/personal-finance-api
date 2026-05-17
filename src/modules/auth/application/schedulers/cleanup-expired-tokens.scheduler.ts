import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IRefreshTokenRepository } from '../../domain/repository/refresh-token.repository';

@Injectable()
export class CleanupExpiredTokensScheduler {
  private readonly logger = new Logger(CleanupExpiredTokensScheduler.name);

  constructor(
    private readonly refreshTokenRepo: IRefreshTokenRepository,
  ) {}

  /** Limpieza diaria a las 3am — borra tokens expirados para acotar el crecimiento de la tabla. */
  @Cron('0 3 * * *')
  async cleanupExpiredTokens(): Promise<void> {
    const deleted = await this.refreshTokenRepo.deleteExpired(new Date());
    this.logger.log(`Cleanup: ${deleted} refresh tokens expirados eliminados`);
  }
}
