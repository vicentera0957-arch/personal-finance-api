import { RefreshToken } from '../entities/refresh-token.entity';

export abstract class IRefreshTokenRepository {
  abstract findByTokenHash(hash: string): Promise<RefreshToken | null>;

  /** Igual que findByTokenHash pero con FOR UPDATE — para la rotación transaccional. */
  abstract findByTokenHashWithLock(hash: string): Promise<RefreshToken | null>;

  abstract save(token: RefreshToken): Promise<void>;

  /** Revoca todos los tokens activos de una familia (replay detection). */
  abstract revokeFamily(familyId: string): Promise<void>;

  /** Elimina tokens expirados. Devuelve el número de filas borradas. */
  abstract deleteExpired(now: Date): Promise<number>;
}
