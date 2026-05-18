import { UserMapper } from './user.mapper';
import { UserOrmEntity } from './user.orm.entity';
import { makeUser } from '../../../../test-support/factories';

describe('UserMapper', () => {
  const mapper = new UserMapper();

  describe('toDomain', () => {
    it('should reconstitute a User with Email VO from the ORM row', () => {
      const orm = new UserOrmEntity();
      orm.id = 'user-1';
      orm.email = 'a@b.cl';
      orm.passwordHash = 'h';
      orm.name = 'Alice';
      orm.createdAt = new Date('2026-01-01T00:00:00Z');
      orm.updatedAt = new Date('2026-01-02T00:00:00Z');

      const user = mapper.toDomain(orm);

      expect(user.id).toBe('user-1');
      expect(user.email.getValue()).toBe('a@b.cl');
      expect(user.getPasswordHash()).toBe('h');
      expect(user.getName()).toBe('Alice');
      expect(user.createdAt).toEqual(orm.createdAt);
    });
  });

  describe('toOrm', () => {
    it('should unwrap Email VO into a primitive string', () => {
      const user = makeUser({ id: 'user-1', email: 'a@b.cl', name: 'Alice' });

      const orm = mapper.toOrm(user);

      expect(orm).toBeInstanceOf(UserOrmEntity);
      expect(orm.id).toBe('user-1');
      expect(orm.email).toBe('a@b.cl');
      expect(orm.name).toBe('Alice');
    });
  });

  describe('round trip', () => {
    it('should preserve all fields through toOrm then toDomain', () => {
      const original = makeUser({
        id: 'user-1',
        email: 'a@b.cl',
        name: 'Alice',
      });

      const roundTripped = mapper.toDomain(mapper.toOrm(original));

      expect(roundTripped.id).toBe(original.id);
      expect(roundTripped.email.getValue()).toBe(original.email.getValue());
      expect(roundTripped.getName()).toBe(original.getName());
      expect(roundTripped.getPasswordHash()).toBe(original.getPasswordHash());
    });
  });
});
