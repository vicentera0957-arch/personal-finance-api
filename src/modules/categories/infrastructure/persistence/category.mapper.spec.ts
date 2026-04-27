import { CategoryMapper } from './category.mapper';
import { CategoryOrmEntity } from './category.orm.entity';
import { makeCategory } from '../../../../test-support/factories';

describe('CategoryMapper', () => {
  const mapper = new CategoryMapper();

  describe('toDomain', () => {
    it('should reconstitute CategoryNature VO and optional fields', () => {
      const orm = new CategoryOrmEntity();
      orm.id = 'c1';
      orm.userId = 'user-1';
      orm.name = 'Food';
      orm.nature = 'expense';
      orm.color = '#fff';
      orm.icon = 'ic';
      orm.createdAt = new Date('2026-01-01T00:00:00Z');
      orm.updatedAt = new Date('2026-01-02T00:00:00Z');

      const category = mapper.toDomain(orm);

      expect(category.id).toBe('c1');
      expect(category.nature.getValue()).toBe('expense');
      expect(category.getColor()).toBe('#fff');
      expect(category.getIcon()).toBe('ic');
    });

  });

  describe('toOrm', () => {
    it('should unwrap nature VO into primitive string', () => {
      const cat = makeCategory({ id: 'c1', nature: 'income' });

      const orm = mapper.toOrm(cat);

      expect(orm).toBeInstanceOf(CategoryOrmEntity);
      expect(orm.nature).toBe('income');
    });
  });

  describe('round trip', () => {
    it('should preserve fields through toOrm + toDomain', () => {
      const original = makeCategory({ id: 'c1', nature: 'expense' });
      const rt = mapper.toDomain(mapper.toOrm(original));
      expect(rt.id).toBe(original.id);
      expect(rt.nature.getValue()).toBe(original.nature.getValue());
    });
  });
});
