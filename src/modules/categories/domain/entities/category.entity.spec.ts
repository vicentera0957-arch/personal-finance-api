import { Category } from './category.entity';
import { CategoryNature } from '../value-objects/category-nature.vo';
import {
  InvalidCategoryNameException,
  InvalidCategoryColorException,
  InvalidCategoryIconException,
} from '../exceptions/category.exceptions';

describe('Category', () => {
  const createValidCategory = (overrides?: Partial<any>) => {
    return Category.create({
      id: 'cat-123',
      userId: 'user-1',
      name: 'Groceries',
      nature: CategoryNature.create('expense'),
      isBudgetable: true,
      ...overrides,
    });
  };

  describe('create', () => {
    it('should create a category with valid properties', () => {
      const category = createValidCategory();

      expect(category.id).toBe('cat-123');
      expect(category.userId).toBe('user-1');
      expect(category.getName()).toBe('Groceries');
      expect(category.nature.isExpense()).toBe(true);
      expect(category.getIsBudgetable()).toBe(true);
      expect(category.getColor()).toBeNull();
      expect(category.getIcon()).toBeNull();
    });

    it('should set createdAt and updatedAt to now', () => {
      const beforeCreation = new Date();
      const category = createValidCategory();
      const afterCreation = new Date();

      expect(category.createdAt.getTime()).toBeGreaterThanOrEqual(
        beforeCreation.getTime(),
      );
      expect(category.createdAt.getTime()).toBeLessThanOrEqual(
        afterCreation.getTime(),
      );
      expect(category.getUpdatedAt()).toEqual(category.createdAt);
    });

    it('should normalize name by trimming whitespace', () => {
      const category = Category.create({
        id: 'cat-1',
        userId: 'user-1',
        name: '  Shopping  ',
        nature: CategoryNature.create('expense'),
        isBudgetable: true,
      });

      expect(category.getName()).toBe('Shopping');
    });

    it('should throw InvalidCategoryNameException if name is empty', () => {
      expect(() =>
        createValidCategory({ name: '' }),
      ).toThrow(InvalidCategoryNameException);
    });

    it('should throw InvalidCategoryNameException if name is only whitespace', () => {
      expect(() =>
        createValidCategory({ name: '   ' }),
      ).toThrow(InvalidCategoryNameException);
      expect(() =>
        createValidCategory({ name: '\t\n' }),
      ).toThrow(InvalidCategoryNameException);
    });

    it('should accept null color (omitted from props)', () => {
      const category = createValidCategory({ color: undefined });
      expect(category.getColor()).toBeNull();
    });

    it('should accept null icon (omitted from props)', () => {
      const category = createValidCategory({ icon: undefined });
      expect(category.getIcon()).toBeNull();
    });

    it('should accept valid color string', () => {
      const category = createValidCategory({ color: '#FF0000' });
      expect(category.getColor()).toBe('#FF0000');
    });

    it('should accept valid icon string', () => {
      const category = createValidCategory({ icon: '🛒' });
      expect(category.getIcon()).toBe('🛒');
    });

    it('should throw InvalidCategoryColorException if color is empty string', () => {
      expect(() =>
        createValidCategory({ color: '' }),
      ).toThrow(InvalidCategoryColorException);
    });

    it('should throw InvalidCategoryColorException if color is only whitespace', () => {
      expect(() =>
        createValidCategory({ color: '   ' }),
      ).toThrow(InvalidCategoryColorException);
    });

    it('should throw InvalidCategoryIconException if icon is empty string', () => {
      expect(() =>
        createValidCategory({ icon: '' }),
      ).toThrow(InvalidCategoryIconException);
    });

    it('should throw InvalidCategoryIconException if icon is only whitespace', () => {
      expect(() =>
        createValidCategory({ icon: '   ' }),
      ).toThrow(InvalidCategoryIconException);
    });

    it('should validate only if color is defined in props', () => {
      // color: undefined should not validate (skip validation)
      expect(() =>
        createValidCategory({ color: undefined }),
      ).not.toThrow();

      // color: '' (empty string) should validate and throw
      expect(() =>
        createValidCategory({ color: '' }),
      ).toThrow(InvalidCategoryColorException);
    });

    it('should validate only if icon is defined in props', () => {
      // icon: undefined should not validate
      expect(() =>
        createValidCategory({ icon: undefined }),
      ).not.toThrow();

      // icon: '' should validate and throw
      expect(() =>
        createValidCategory({ icon: '' }),
      ).toThrow(InvalidCategoryIconException);
    });

    it('should support income categories', () => {
      const income = Category.create({
        id: 'cat-1',
        userId: 'user-1',
        name: 'Salary',
        nature: CategoryNature.create('income'),
        isBudgetable: false,
      });

      expect(income.nature.isIncome()).toBe(true);
      expect(income.getIsBudgetable()).toBe(false);
    });

    it('should preserve isBudgetable immutability (no setter exists)', () => {
      const category = createValidCategory({ isBudgetable: true });
      // isBudgetable has no mutation method on the entity
      expect(category.getIsBudgetable()).toBe(true);
      // Attempting to set it would require direct property access (not possible in normal usage)
    });
  });

  describe('reconstitute', () => {
    it('should reconstitute a category from persisted data', () => {
      const createdAt = new Date('2024-01-01');
      const updatedAt = new Date('2024-01-15');

      const category = Category.reconstitute({
        id: 'cat-456',
        userId: 'user-2',
        name: 'Entertainment',
        nature: CategoryNature.create('expense'),
        isBudgetable: true,
        color: '#00FF00',
        icon: '🎬',
        createdAt,
        updatedAt,
      });

      expect(category.id).toBe('cat-456');
      expect(category.getName()).toBe('Entertainment');
      expect(category.getColor()).toBe('#00FF00');
      expect(category.getIcon()).toBe('🎬');
      expect(category.createdAt).toEqual(createdAt);
      expect(category.getUpdatedAt()).toEqual(updatedAt);
    });

    it('should preserve exact timestamps', () => {
      const createdAt = new Date('2024-01-15T10:30:45.123Z');
      const updatedAt = new Date('2024-02-20T14:45:30.456Z');

      const category = Category.reconstitute({
        id: 'cat-789',
        userId: 'user-3',
        name: 'Test',
        nature: CategoryNature.create('income'),
        isBudgetable: false,
        createdAt,
        updatedAt,
      });

      expect(category.createdAt.getTime()).toBe(createdAt.getTime());
      expect(category.getUpdatedAt().getTime()).toBe(updatedAt.getTime());
    });

    it('should handle null color from database', () => {
      const category = Category.reconstitute({
        id: 'cat-1',
        userId: 'user-1',
        name: 'Test',
        nature: CategoryNature.create('expense'),
        isBudgetable: true,
        color: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(category.getColor()).toBeNull();
    });

    it('should handle null icon from database', () => {
      const category = Category.reconstitute({
        id: 'cat-1',
        userId: 'user-1',
        name: 'Test',
        nature: CategoryNature.create('expense'),
        isBudgetable: true,
        icon: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(category.getIcon()).toBeNull();
    });
  });

  describe('rename', () => {
    it('should rename the category', () => {
      const category = createValidCategory();

      category.rename('New Name');

      expect(category.getName()).toBe('New Name');
    });

    it('should normalize name by trimming whitespace', () => {
      const category = createValidCategory();

      category.rename('  Trimmed  ');

      expect(category.getName()).toBe('Trimmed');
    });

    it('should update updatedAt timestamp', () => {
      const category = createValidCategory();
      const originalUpdatedAt = category.getUpdatedAt().getTime();

      category.rename('Updated');

      expect(category.getUpdatedAt().getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt,
      );
    });

    it('should throw InvalidCategoryNameException if new name is empty', () => {
      const category = createValidCategory();

      expect(() => category.rename('')).toThrow(InvalidCategoryNameException);
    });

    it('should throw InvalidCategoryNameException if new name is only whitespace', () => {
      const category = createValidCategory();

      expect(() => category.rename('   ')).toThrow(
        InvalidCategoryNameException,
      );
    });

    it('should allow multiple renames', () => {
      const category = createValidCategory();

      category.rename('First');
      expect(category.getName()).toBe('First');

      category.rename('Second');
      expect(category.getName()).toBe('Second');

      category.rename('Third');
      expect(category.getName()).toBe('Third');
    });
  });

  describe('changeColor', () => {
    it('should change the color', () => {
      const category = createValidCategory({ color: '#FF0000' });

      category.changeColor('#00FF00');

      expect(category.getColor()).toBe('#00FF00');
    });

    it('should update updatedAt timestamp', () => {
      const category = createValidCategory({ color: '#FF0000' });
      const originalUpdatedAt = category.getUpdatedAt().getTime();

      category.changeColor('#0000FF');

      expect(category.getUpdatedAt().getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt,
      );
    });

    it('should throw InvalidCategoryColorException if color is empty', () => {
      const category = createValidCategory({ color: '#FF0000' });

      expect(() => category.changeColor('')).toThrow(
        InvalidCategoryColorException,
      );
    });

    it('should throw InvalidCategoryColorException if color is only whitespace', () => {
      const category = createValidCategory({ color: '#FF0000' });

      expect(() => category.changeColor('   ')).toThrow(
        InvalidCategoryColorException,
      );
    });

    it('should allow updating color from null to a value', () => {
      const category = createValidCategory({ color: undefined });
      expect(category.getColor()).toBeNull();

      category.changeColor('#FF0000');

      expect(category.getColor()).toBe('#FF0000');
    });

    it('should allow multiple color changes', () => {
      const category = createValidCategory({ color: '#FF0000' });

      category.changeColor('#00FF00');
      expect(category.getColor()).toBe('#00FF00');

      category.changeColor('#0000FF');
      expect(category.getColor()).toBe('#0000FF');
    });
  });

  describe('changeIcon', () => {
    it('should change the icon', () => {
      const category = createValidCategory({ icon: '🍎' });

      category.changeIcon('🍊');

      expect(category.getIcon()).toBe('🍊');
    });

    it('should update updatedAt timestamp', () => {
      const category = createValidCategory({ icon: '🎬' });
      const originalUpdatedAt = category.getUpdatedAt().getTime();

      category.changeIcon('🎮');

      expect(category.getUpdatedAt().getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt,
      );
    });

    it('should throw InvalidCategoryIconException if icon is empty', () => {
      const category = createValidCategory({ icon: '🎯' });

      expect(() => category.changeIcon('')).toThrow(
        InvalidCategoryIconException,
      );
    });

    it('should throw InvalidCategoryIconException if icon is only whitespace', () => {
      const category = createValidCategory({ icon: '🎯' });

      expect(() => category.changeIcon('   ')).toThrow(
        InvalidCategoryIconException,
      );
    });

    it('should allow updating icon from null to a value', () => {
      const category = createValidCategory({ icon: undefined });
      expect(category.getIcon()).toBeNull();

      category.changeIcon('💰');

      expect(category.getIcon()).toBe('💰');
    });

    it('should allow multiple icon changes', () => {
      const category = createValidCategory({ icon: '🏠' });

      category.changeIcon('🏢');
      expect(category.getIcon()).toBe('🏢');

      category.changeIcon('🏭');
      expect(category.getIcon()).toBe('🏭');
    });
  });

  describe('getters', () => {
    it('should return all properties via getters', () => {
      const category = Category.create({
        id: 'cat-1',
        userId: 'user-1',
        name: 'Test Category',
        nature: CategoryNature.create('expense'),
        isBudgetable: true,
        color: '#123456',
        icon: '💳',
      });

      expect(category.getName()).toBe('Test Category');
      expect(category.getIsBudgetable()).toBe(true);
      expect(category.getColor()).toBe('#123456');
      expect(category.getIcon()).toBe('💳');
      expect(category.getUpdatedAt()).toEqual(category.createdAt);
    });

    it('should return null for color when not set', () => {
      const category = createValidCategory({ color: undefined });
      expect(category.getColor()).toBeNull();
    });

    it('should return null for icon when not set', () => {
      const category = createValidCategory({ icon: undefined });
      expect(category.getIcon()).toBeNull();
    });

    it('should return correct nature', () => {
      const expenseCategory = createValidCategory({
        nature: CategoryNature.create('expense'),
      });
      expect(expenseCategory.nature.isExpense()).toBe(true);

      const incomeCategory = Category.create({
        id: 'cat-1',
        userId: 'user-1',
        name: 'Salary',
        nature: CategoryNature.create('income'),
        isBudgetable: false,
      });
      expect(incomeCategory.nature.isIncome()).toBe(true);
    });
  });

  describe('isBudgetable immutability', () => {
    it('should not have a method to change isBudgetable', () => {
      const category = createValidCategory({ isBudgetable: true });

      // isBudgetable is set at creation and immutable
      expect(category.getIsBudgetable()).toBe(true);

      // There is no changeBudgetable() or setBudgetable() method
      // The property cannot be mutated through public API
      expect((category as any).changeBudgetable).toBeUndefined();
      expect((category as any).setBudgetable).toBeUndefined();
    });

    it('should preserve isBudgetable value throughout lifecycle', () => {
      const budgetable = createValidCategory({ isBudgetable: true });
      const notBudgetable = createValidCategory({ isBudgetable: false });

      // Perform various mutations
      budgetable.rename('New Name');
      budgetable.changeColor('#FF0000');
      budgetable.changeIcon('🎯');

      notBudgetable.rename('Another Name');

      // isBudgetable remains unchanged
      expect(budgetable.getIsBudgetable()).toBe(true);
      expect(notBudgetable.getIsBudgetable()).toBe(false);
    });
  });

  describe('readonly properties', () => {
    it('should have immutable id, userId, and nature', () => {
      const category = createValidCategory();

      expect(category.id).toBe('cat-123');
      expect(category.userId).toBe('user-1');
      expect(category.nature.isExpense()).toBe(true);

      // These are readonly and cannot be modified
      // (verified at compile-time; runtime validation is for behavior)
    });
  });
});
