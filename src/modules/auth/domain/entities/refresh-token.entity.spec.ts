import { RefreshToken } from './refresh-token.entity';

function futureDate(ms = 60_000): Date {
  return new Date(Date.now() + ms);
}
function pastDate(ms = 60_000): Date {
  return new Date(Date.now() - ms);
}

describe('RefreshToken entity', () => {
  describe('create()', () => {
    it('initializes revokedAt and replacedById to null', () => {
      const token = RefreshToken.create({
        id: 'jti-1',
        userId: 'user-1',
        familyId: 'family-1',
        tokenHash: 'hash-abc',
        expiresAt: futureDate(),
      });

      expect(token.revokedAt).toBeNull();
      expect(token.replacedById).toBeNull();
      expect(token.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('reconstitute()', () => {
    it('preserves all fields exactly as they come from the DB', () => {
      const now = new Date();
      const token = RefreshToken.reconstitute({
        id: 'jti-1',
        userId: 'user-1',
        familyId: 'family-1',
        tokenHash: 'hash-abc',
        expiresAt: futureDate(),
        createdAt: now,
        revokedAt: null,
        replacedById: null,
      });

      expect(token.id).toBe('jti-1');
      expect(token.createdAt).toBe(now);
    });
  });

  describe('isRevoked()', () => {
    it('returns false for a new token', () => {
      const token = RefreshToken.create({
        id: 'j',
        userId: 'u',
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: futureDate(),
      });
      expect(token.isRevoked()).toBe(false);
    });

    it('returns true after revoke()', () => {
      const token = RefreshToken.create({
        id: 'j',
        userId: 'u',
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: futureDate(),
      });
      token.revoke();
      expect(token.isRevoked()).toBe(true);
      expect(token.revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('isExpired()', () => {
    it('returns false if expiresAt is in the future', () => {
      const token = RefreshToken.create({
        id: 'j',
        userId: 'u',
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: futureDate(),
      });
      expect(token.isExpired()).toBe(false);
    });

    it('returns true if expiresAt is in the past', () => {
      const token = RefreshToken.create({
        id: 'j',
        userId: 'u',
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: pastDate(),
      });
      expect(token.isExpired()).toBe(true);
    });
  });

  describe('isUsable()', () => {
    it('returns true for a valid, non-expired token', () => {
      const token = RefreshToken.create({
        id: 'j',
        userId: 'u',
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: futureDate(),
      });
      expect(token.isUsable()).toBe(true);
    });

    it('returns false if revoked', () => {
      const token = RefreshToken.create({
        id: 'j',
        userId: 'u',
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: futureDate(),
      });
      token.revoke();
      expect(token.isUsable()).toBe(false);
    });

    it('returns false if expired', () => {
      const token = RefreshToken.create({
        id: 'j',
        userId: 'u',
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: pastDate(),
      });
      expect(token.isUsable()).toBe(false);
    });
  });

  describe('revoke()', () => {
    it('stores replacedById when passed during rotation', () => {
      const token = RefreshToken.create({
        id: 'j',
        userId: 'u',
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: futureDate(),
      });
      token.revoke('new-jti');
      expect(token.replacedById).toBe('new-jti');
    });

    it('leaves replacedById null on logout (no argument)', () => {
      const token = RefreshToken.create({
        id: 'j',
        userId: 'u',
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: futureDate(),
      });
      token.revoke();
      expect(token.replacedById).toBeNull();
    });
  });
});
