import { BcryptPasswordHasher } from './bcrypt-password-hasher';

describe('BcryptPasswordHasher', () => {
  const hasher = new BcryptPasswordHasher();

  describe('hash', () => {
    it('should produce a bcrypt hash different from the plaintext', async () => {
      const hash = await hasher.hash('secret');

      expect(hash).not.toBe('secret');
      expect(hash).toMatch(/^\$2[aby]\$/);
    });

    it('should produce distinct hashes for the same input (salt)', async () => {
      const a = await hasher.hash('secret');
      const b = await hasher.hash('secret');
      expect(a).not.toBe(b);
    });
  });

  describe('compare', () => {
    it('should return true when plaintext matches the hash', async () => {
      const hash = await hasher.hash('secret');
      expect(await hasher.compare('secret', hash)).toBe(true);
    });

    it('should return false for mismatching plaintext', async () => {
      const hash = await hasher.hash('secret');
      expect(await hasher.compare('wrong', hash)).toBe(false);
    });
  });
});
