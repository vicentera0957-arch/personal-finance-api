import { IRefreshTokenRepository } from '../../../domain/repository/refresh-token.repository';
import { RefreshToken } from '../../../domain/entities/refresh-token.entity';

/**
 * In-memory fake of IRefreshTokenRepository for unit tests. Map-backed (keyed by
 * id, the PK), behaves like the real store: save then find returns it, and
 * revokeFamily mutates every active token sharing the familyId — so replay tests
 * can assert real state ("the family is revoked") instead of "revokeFamily was
 * called". No locks (findByTokenHashWithLock == findByTokenHash); locking is an
 * integration concern.
 */
export class InMemoryRefreshTokenRepository extends IRefreshTokenRepository {
  private readonly store = new Map<string, RefreshToken>();

  async findByTokenHash(hash: string): Promise<RefreshToken | null> {
    for (const token of this.store.values()) {
      if (token.tokenHash === hash) return token;
    }
    return null;
  }

  async findByTokenHashWithLock(hash: string): Promise<RefreshToken | null> {
    return this.findByTokenHash(hash);
  }

  async save(token: RefreshToken): Promise<void> {
    this.store.set(token.id, token);
  }

  async revokeFamily(familyId: string): Promise<void> {
    for (const token of this.store.values()) {
      if (token.familyId === familyId && !token.isRevoked()) token.revoke();
    }
  }

  async deleteExpired(now: Date): Promise<number> {
    let deleted = 0;
    for (const [id, token] of this.store.entries()) {
      if (token.expiresAt < now) {
        this.store.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  // ── Test helpers ──
  seed(tokens: RefreshToken[]): void {
    for (const token of tokens) this.store.set(token.id, token);
  }

  size(): number {
    return this.store.size;
  }
}
