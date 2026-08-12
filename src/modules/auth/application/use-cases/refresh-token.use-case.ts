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

// Salida discriminada de la transacción (docs/history/structural-refactors.md, P3+P4 (§2.4.b del plan archivado), opción R1). El
// caso replay revoca la familia y termina la transacción de forma NORMAL —
// el runner commitea — porque la revocación debe persistir aunque la
// request termine en 401 (CLAUDE.md, "Flows": "the commit is intentional:
// the family must be locked out even if the request fails"). El 401 se
// decide DESPUÉS del commit, afuera de run(): revocar la familia es un
// desenlace exitoso de la transacción, no un error de ella.
type RefreshOutcome =
  | { readonly kind: 'rotated'; readonly pair: TokenPair }
  | { readonly kind: 'replay' };

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

    const outcome = await this.uow.run<RefreshOutcome>(async (ctx) => {
      // LOCK (FOR UPDATE): refresh-token row. The lock lives inside the scoped repo's
      // findByTokenHashWithLock(). Serializes two concurrent /refresh calls on the same
      // token (e.g. two tabs); replay detection depends on this serialization.
      const stored = await ctx.refreshTokens.findByTokenHashWithLock(tokenHash);

      if (!stored) throw new InvalidRefreshTokenException();

      if (stored.isRevoked()) {
        // REPLAY DETECTADO: alguien usó un token ya rotado.
        // Revocar toda la familia para expulsar tanto al atacante como al usuario legítimo.
        await ctx.refreshTokens.revokeFamily(stored.familyId);
        return { kind: 'replay' }; // ← salida NORMAL ⇒ el runner commitea
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
      await ctx.refreshTokens.save(newEntity);

      stored.revoke(newJti); // marca el viejo como "reemplazado por newJti"
      await ctx.refreshTokens.save(stored);

      const newAccessToken = await this.tokenProvider.generateAccessToken({
        sub: stored.userId,
        email: payload.email,
      });
      return {
        kind: 'rotated',
        pair: { accessToken: newAccessToken, refreshToken: newRefreshToken },
      };
    });

    if (outcome.kind === 'replay') {
      throw new RefreshTokenReplayDetectedException();
    }
    return outcome.pair;
  }
}
