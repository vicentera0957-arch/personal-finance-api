import { AccountMapper } from './account.mapper';
import { AccountOrmEntity } from './account.orm.entity';
import { makeAccount } from '../../../../test-support/factories';

describe('AccountMapper', () => {
  const mapper = new AccountMapper();

  describe('toDomain', () => {
    it('should reconstitute Balance and AccountType VOs from ORM row', () => {
      const orm = new AccountOrmEntity();
      orm.id = 'a1';
      orm.userId = 'user-1';
      orm.name = 'Main';
      orm.type = 'corriente';
      orm.initialBalance = 1000;
      orm.currentBalance = 900;
      orm.isArchived = false;
      orm.createdAt = new Date('2026-01-01T00:00:00Z');
      orm.updatedAt = new Date('2026-01-02T00:00:00Z');

      const account = mapper.toDomain(orm);

      expect(account.id).toBe('a1');
      expect(account.userId).toBe('user-1');
      expect(account.getCurrentBalance().getValue()).toBe(900);
      expect(account.getInitialBalance().getValue()).toBe(1000);
      expect(account.type.getType()).toBe('corriente');
      expect(account.getIsArchived()).toBe(false);
    });
  });

  describe('toOrm', () => {
    it('should unwrap VOs into primitives', () => {
      const account = makeAccount({
        id: 'a1',
        userId: 'user-1',
        type: 'ahorro',
        initialBalance: 500,
        currentBalance: 450,
      });

      const orm = mapper.toOrm(account);

      expect(orm).toBeInstanceOf(AccountOrmEntity);
      expect(orm.type).toBe('ahorro');
      expect(orm.initialBalance).toBe(500);
      expect(orm.currentBalance).toBe(450);
      expect(orm.isArchived).toBe(false);
    });
  });

  describe('round trip', () => {
    it('should preserve all fields through toOrm then toDomain', () => {
      const original = makeAccount({
        id: 'a1',
        userId: 'user-1',
        initialBalance: 1000,
        currentBalance: 700,
      });

      const rt = mapper.toDomain(mapper.toOrm(original));

      expect(rt.id).toBe(original.id);
      expect(rt.getCurrentBalance().getValue()).toBe(
        original.getCurrentBalance().getValue(),
      );
      expect(rt.type.getType()).toBe(original.type.getType());
    });
  });
});
