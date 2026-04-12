import { CategoryNature } from './category-nature.vo';
import { InvalidCategoryNatureException } from '../exceptions/category.exceptions';

describe('CategoryNature', () => {
  describe('create', () => {
    it('should create CategoryNature with "income"', () => {
      const nature = CategoryNature.create('income');
      expect(nature.getValue()).toBe('income');
      expect(nature.isIncome()).toBe(true);
      expect(nature.isExpense()).toBe(false);
    });

    it('should create CategoryNature with "expense"', () => {
      const nature = CategoryNature.create('expense');
      expect(nature.getValue()).toBe('expense');
      expect(nature.isExpense()).toBe(true);
      expect(nature.isIncome()).toBe(false);
    });

    it('should normalize uppercase to lowercase', () => {
      const incomeUpper = CategoryNature.create('INCOME');
      expect(incomeUpper.getValue()).toBe('income');

      const expenseUpper = CategoryNature.create('EXPENSE');
      expect(expenseUpper.getValue()).toBe('expense');

      const mixedCase = CategoryNature.create('IncOme');
      expect(mixedCase.getValue()).toBe('income');
    });

    it('should trim whitespace before validating', () => {
      const incomeTrimmed = CategoryNature.create('  income  ');
      expect(incomeTrimmed.getValue()).toBe('income');

      const expenseTrimmed = CategoryNature.create('\texpense\n');
      expect(expenseTrimmed.getValue()).toBe('expense');

      const spacesAndCase = CategoryNature.create('  INCOME  ');
      expect(spacesAndCase.getValue()).toBe('income');
    });

    it('should throw InvalidCategoryNatureException if value is empty string', () => {
      expect(() => CategoryNature.create('')).toThrow(
        InvalidCategoryNatureException,
      );
    });

    it('should throw InvalidCategoryNatureException if value is only whitespace', () => {
      expect(() => CategoryNature.create('   ')).toThrow(
        InvalidCategoryNatureException,
      );
      expect(() => CategoryNature.create('\t')).toThrow(
        InvalidCategoryNatureException,
      );
      expect(() => CategoryNature.create('\n')).toThrow(
        InvalidCategoryNatureException,
      );
    });

    it('should throw InvalidCategoryNatureException if value is null', () => {
      expect(() => CategoryNature.create(null as any)).toThrow(
        InvalidCategoryNatureException,
      );
    });

    it('should throw InvalidCategoryNatureException if value is undefined', () => {
      expect(() => CategoryNature.create(undefined as any)).toThrow(
        InvalidCategoryNatureException,
      );
    });

    it('should throw InvalidCategoryNatureException for invalid nature after normalization', () => {
      expect(() => CategoryNature.create('invalid')).toThrow(
        InvalidCategoryNatureException,
      );
      expect(() => CategoryNature.create('INVALID')).toThrow(
        InvalidCategoryNatureException,
      );
      expect(() => CategoryNature.create('inflow')).toThrow(
        InvalidCategoryNatureException,
      );
      expect(() => CategoryNature.create('outflow')).toThrow(
        InvalidCategoryNatureException,
      );
    });

    it('should validate nature AFTER normalization', () => {
      // This confirms the order: normalize first, then validate
      expect(() => CategoryNature.create('  INCOME  ')).not.toThrow();
      expect(CategoryNature.create('  INCOME  ').getValue()).toBe('income');
    });
  });

  describe('reconstitute', () => {
    it('should reconstitute "income" from database', () => {
      const nature = CategoryNature.reconstitute('income');
      expect(nature.getValue()).toBe('income');
      expect(nature.isIncome()).toBe(true);
    });

    it('should reconstitute "expense" from database', () => {
      const nature = CategoryNature.reconstitute('expense');
      expect(nature.getValue()).toBe('expense');
      expect(nature.isExpense()).toBe(true);
    });

    it('should trust database data without normalization or validation', () => {
      // reconstitute expects data to be exactly as stored (lowercase)
      // It just bypasses validation and casts the type
      const nature = CategoryNature.reconstitute('income');
      expect(nature.getValue()).toBe('income');
    });
  });

  describe('isIncome', () => {
    it('should return true for income nature', () => {
      const nature = CategoryNature.create('income');
      expect(nature.isIncome()).toBe(true);
    });

    it('should return false for expense nature', () => {
      const nature = CategoryNature.create('expense');
      expect(nature.isIncome()).toBe(false);
    });

    it('should work with different case inputs after normalization', () => {
      const nature = CategoryNature.create('INCOME');
      expect(nature.isIncome()).toBe(true);
    });
  });

  describe('isExpense', () => {
    it('should return true for expense nature', () => {
      const nature = CategoryNature.create('expense');
      expect(nature.isExpense()).toBe(true);
    });

    it('should return false for income nature', () => {
      const nature = CategoryNature.create('income');
      expect(nature.isExpense()).toBe(false);
    });

    it('should work with different case inputs after normalization', () => {
      const nature = CategoryNature.create('EXPENSE');
      expect(nature.isExpense()).toBe(true);
    });
  });

  describe('equals', () => {
    it('should return true when natures are equal', () => {
      const nature1 = CategoryNature.create('income');
      const nature2 = CategoryNature.create('income');

      expect(nature1.equals(nature2)).toBe(true);
    });

    it('should return true even with different input cases', () => {
      const nature1 = CategoryNature.create('INCOME');
      const nature2 = CategoryNature.create('income');

      expect(nature1.equals(nature2)).toBe(true);
    });

    it('should return false when natures are different', () => {
      const income = CategoryNature.create('income');
      const expense = CategoryNature.create('expense');

      expect(income.equals(expense)).toBe(false);
    });

    it('should compare reconstituted and created instances correctly', () => {
      const created = CategoryNature.create('expense');
      const reconstituted = CategoryNature.reconstitute('expense');

      expect(created.equals(reconstituted)).toBe(true);
    });
  });

  describe('getValue', () => {
    it('should return "income" for income nature', () => {
      const nature = CategoryNature.create('income');
      expect(nature.getValue()).toBe('income');
    });

    it('should return "expense" for expense nature', () => {
      const nature = CategoryNature.create('expense');
      expect(nature.getValue()).toBe('expense');
    });

    it('should always return lowercase normalized value', () => {
      const upperCase = CategoryNature.create('INCOME');
      expect(upperCase.getValue()).toBe('income');

      const whitespace = CategoryNature.create('  expense  ');
      expect(whitespace.getValue()).toBe('expense');
    });
  });
});
