import { RefreshToken } from './refresh-token.entity';

function futureDate(ms = 60_000): Date {
  return new Date(Date.now() + ms);
}
function pastDate(ms = 60_000): Date {
  return new Date(Date.now() - ms);
}

describe('RefreshToken entity', () => {
  describe('create()', () => {
    it('inicializa revokedAt en null y replacedById en null', () => {
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
    it('preserva todos los campos tal cual vienen de DB', () => {
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
    it('devuelve false para un token nuevo', () => {
      const token = RefreshToken.create({
        id: 'j',
        userId: 'u',
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: futureDate(),
      });
      expect(token.isRevoked()).toBe(false);
    });

    it('devuelve true después de revoke()', () => {
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
    it('devuelve false si expiresAt es en el futuro', () => {
      const token = RefreshToken.create({
        id: 'j',
        userId: 'u',
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: futureDate(),
      });
      expect(token.isExpired()).toBe(false);
    });

    it('devuelve true si expiresAt es en el pasado', () => {
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
    it('devuelve true para un token válido y no expirado', () => {
      const token = RefreshToken.create({
        id: 'j',
        userId: 'u',
        familyId: 'f',
        tokenHash: 'h',
        expiresAt: futureDate(),
      });
      expect(token.isUsable()).toBe(true);
    });

    it('devuelve false si está revocado', () => {
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

    it('devuelve false si está expirado', () => {
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
    it('guarda replacedById cuando se pasa en rotación', () => {
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

    it('deja replacedById en null en logout (sin argumento)', () => {
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
