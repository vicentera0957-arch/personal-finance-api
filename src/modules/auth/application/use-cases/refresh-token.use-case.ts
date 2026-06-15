import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  ITokenProvider,
  TokenPair,
} from '../../domain/ports/token-provider.port';
import { IAuthUnitOfWork } from '../../domain/IAuthUnitOfWork';
import { RefreshToken } from '../../domain/entities/refresh-token.entity';
import {
  InvalidRefreshTokenException,
  RefreshTokenExpiredException,
  RefreshTokenReplayDetectedException,
} from '../../domain/exceptions/auth.exceptions';
import { sha256 } from '../utils/token-hash.util';

@Injectable()
export class RefreshTokenUseCase {
  constructor(
    private readonly tokenProvider: ITokenProvider,
    private readonly uow: IAuthUnitOfWork,
  ) {}

  async execute(rawToken: string): Promise<TokenPair> {
    // Verifica firma JWT primero — fallo rápido sin ir a DB para tokens mal formados.
    const payload = await this.tokenProvider.verifyRefreshToken(rawToken);
    const tokenHash = sha256(rawToken);

    let committed = false;
    await this.uow.begin();

    try {
      const repo = this.uow.getRefreshTokenRepository();

      // LOCK (FOR UPDATE): refresh-token row. The lock lives inside the scoped repo's
      // findByTokenHashWithLock(). Serializes two concurrent /refresh calls on the same
      // token (e.g. two tabs); replay detection depends on this serialization.
      const stored = await repo.findByTokenHashWithLock(tokenHash);

      if (!stored) throw new InvalidRefreshTokenException();

      if (stored.isRevoked()) {
        // REPLAY DETECTADO: alguien usó un token ya rotado.
        // Revocar toda la familia para expulsar tanto al atacante como al usuario legítimo.
        await repo.revokeFamily(stored.familyId);
        await this.uow.commit();
        committed = true;
        throw new RefreshTokenReplayDetectedException();
      }

      if (stored.isExpired()) throw new RefreshTokenExpiredException();

      // ── Rotación ──────────────────────────────────────────────────────────────
      const newJti = uuidv4();
      const newRefreshToken = await this.tokenProvider.generateRefreshToken({
        // infra provider
        sub: stored.userId,
        email: payload.email,
        jti: newJti,
      });
      const newHash = sha256(newRefreshToken);

      const newEntity = RefreshToken.create({
        //domain entity
        id: newJti,
        userId: stored.userId,
        familyId: stored.familyId, // misma familia — permite revocar toda la cadena si hay replay
        tokenHash: newHash,
        expiresAt: this.tokenProvider.getRefreshTokenExpiresAt(),
      });

      // Insertar primero el token nuevo: el viejo lo referencia vía
      // replaced_by_id (FK auto-referencial), así que la fila destino debe
      // existir antes de grabar el UPDATE del viejo (si no, viola la FK).
      await repo.save(newEntity);

      stored.revoke(newJti); // marca el viejo como "reemplazado por newJti"
      await repo.save(stored);

      const newAccessToken = await this.tokenProvider.generateAccessToken({
        sub: stored.userId,
        email: payload.email,
      });
      await this.uow.commit();
      committed = true;
      return { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } catch (err) {
      if (!committed) await this.uow.rollback();
      throw err;
    } finally {
      await this.uow.release();
    }
  }
}
