import { TransactionMapper } from './transaction.mapper';
import { TransactionOrmEntity } from './transaction.orm.entity';
import { makeTransaction } from '../../../../test-support/factories';

describe('TransactionMapper', () => {
  const mapper = new TransactionMapper();

  describe('toDomain', () => {
    it('should reconstitute TransactionNature and Amount VOs from ORM row', () => {
      const orm = new TransactionOrmEntity();
      orm.id = 't1';
      orm.userId = 'user-1';
      orm.accountId = 'a1';
      orm.categoryId = 'c1';
      orm.nature = 'expense';
      orm.amount = 100;
      orm.description = 'lunch';
      orm.transactionDate = new Date('2026-03-15T12:00:00Z');
      orm.createdAt = new Date('2026-03-15T12:00:00Z');

      const tx = mapper.toDomain(orm);

      expect(tx.id).toBe('t1');
      expect(tx.nature.getValue()).toBe('expense');
      expect(tx.amount.getValue()).toBe(100);
      expect(tx.description).toBe('lunch');
    });
  });

  describe('toOrm', () => {
    it('should unwrap nature and amount VOs', () => {
      const tx = makeTransaction({ id: 't1', amount: 200, nature: 'income' });

      const orm = mapper.toOrm(tx);

      expect(orm).toBeInstanceOf(TransactionOrmEntity);
      expect(orm.nature).toBe('income');
      expect(orm.amount).toBe(200);
    });
  });

  describe('round trip', () => {
    it('should preserve fields through toOrm + toDomain', () => {
      const original = makeTransaction({ id: 't1', amount: 100, description: 'lunch' });
      const rt = mapper.toDomain(mapper.toOrm(original));
      expect(rt.id).toBe(original.id);
      expect(rt.amount.getValue()).toBe(100);
      expect(rt.description).toBe('lunch');
    });
  });
});
