import { BudgetMapper } from './budget.mapper';
import { BudgetOrmEntity } from './budget.orm.entity';
import { makeBudget } from '../../../../test-support/factories';

describe('BudgetMapper', () => {
  const mapper = new BudgetMapper();

  describe('toDomain', () => {
    it('should reconstitute AmountLimit VO from ORM row', () => {
      const orm = new BudgetOrmEntity();
      orm.id = 'b1';
      orm.userId = 'user-1';
      orm.categoryId = 'c1';
      orm.month = 3;
      orm.year = 2026;
      orm.limit = 500;
      orm.createdAt = new Date();
      orm.updatedAt = new Date();

      const budget = mapper.toDomain(orm);

      expect(budget.id).toBe('b1');
      expect(budget.month).toBe(3);
      expect(budget.year).toBe(2026);
      expect(budget.getLimit().getValue()).toBe(500);
    });
  });

  describe('toOrm', () => {
    it('should unwrap AmountLimit into primitive', () => {
      const budget = makeBudget({ id: 'b1', month: 3, year: 2026, limit: 500 });

      const orm = mapper.toOrm(budget);

      expect(orm).toBeInstanceOf(BudgetOrmEntity);
      expect(orm.limit).toBe(500);
      expect(orm.month).toBe(3);
      expect(orm.year).toBe(2026);
    });
  });

  describe('round trip', () => {
    it('should preserve fields through toOrm + toDomain', () => {
      const original = makeBudget({ id: 'b1', limit: 750 });
      const rt = mapper.toDomain(mapper.toOrm(original));
      expect(rt.id).toBe(original.id);
      expect(rt.getLimit().getValue()).toBe(750);
    });
  });
});
