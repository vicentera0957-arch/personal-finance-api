import { TransactionNature } from './transaction-nature.vo';
import {
  EmptyTransactionNatureException,
  InvalidTransactionNatureException,
} from '../exceptions/transaction.exceptions';

describe('TransactionNature', () => {
  describe('create', () => {
    it('should create TransactionNature with "income"', () => {
      const nature = TransactionNature.create('income');
      expect(nature.getValue()).toBe('income');
      expect(nature.isIncome()).toBe(true);
      expect(nature.isExpense()).toBe(false);
    });

    it('should create TransactionNature with "expense"', () => {
      const nature = TransactionNature.create('expense');
      expect(nature.getValue()).toBe('expense');
      expect(nature.isExpense()).toBe(true);
      expect(nature.isIncome()).toBe(false);
    });

    it('should normalize uppercase to lowercase', () => {
      const incomeUpper = TransactionNature.create('INCOME');
      expect(incomeUpper.getValue()).toBe('income');

      const expenseUpper = TransactionNature.create('EXPENSE');
      expect(expenseUpper.getValue()).toBe('expense');

      const mixedCase = TransactionNature.create('IncOme');
      expect(mixedCase.getValue()).toBe('income');
    });

    it('should trim whitespace before validating', () => {
      const incomeTrimmed = TransactionNature.create('  income  ');
      expect(incomeTrimmed.getValue()).toBe('income');

      const expenseTrimmed = TransactionNature.create('\texpense\n');
      expect(expenseTrimmed.getValue()).toBe('expense');

      const spacesAndCase = TransactionNature.create('  INCOME  ');
      expect(spacesAndCase.getValue()).toBe('income');
    });

    it('should throw EmptyTransactionNatureException if value is empty string', () => {
      expect(() => TransactionNature.create('')).toThrow(
        EmptyTransactionNatureException,
      );
    });

    it('should throw EmptyTransactionNatureException if value is only whitespace', () => {
      expect(() => TransactionNature.create('   ')).toThrow(
        EmptyTransactionNatureException,
      );
      expect(() => TransactionNature.create('\t')).toThrow(
        EmptyTransactionNatureException,
      );
      expect(() => TransactionNature.create('\n')).toThrow(
        EmptyTransactionNatureException,
      );
    });

    it('should throw EmptyTransactionNatureException if value is null/undefined', () => {
      expect(() => TransactionNature.create(null as unknown as string)).toThrow(
        EmptyTransactionNatureException,
      );
      expect(() =>
        TransactionNature.create(undefined as unknown as string),
      ).toThrow(EmptyTransactionNatureException);
    });

    it('should throw InvalidTransactionNatureException for invalid nature after normalization', () => {
      expect(() => TransactionNature.create('invalid')).toThrow(
        InvalidTransactionNatureException,
      );
      expect(() => TransactionNature.create('INVALID')).toThrow(
        InvalidTransactionNatureException,
      );
      expect(() => TransactionNature.create('income-expense')).toThrow(
        InvalidTransactionNatureException,
      );
      expect(() => TransactionNature.create('inflow')).toThrow(
        InvalidTransactionNatureException,
      );
    });

    it('should validate nature AFTER normalization', () => {
      // This confirms the order: normalize first, then validate
      expect(() => TransactionNature.create('  INCOME  ')).not.toThrow();
      expect(TransactionNature.create('  INCOME  ').getValue()).toBe('income');
    });

    it('should throw EmptyTransactionNatureException BEFORE format validation', () => {
      // Empty check happens first
      expect(() => TransactionNature.create('')).toThrow(
        EmptyTransactionNatureException,
      );
      expect(() => TransactionNature.create('   ')).toThrow(
        EmptyTransactionNatureException,
      );
    });
  });

  describe('reconstitute', () => {
    it('should reconstitute "income" from database', () => {
      const nature = TransactionNature.reconstitute('income');
      expect(nature.getValue()).toBe('income');
      expect(nature.isIncome()).toBe(true);
    });

    it('should reconstitute "expense" from database', () => {
      const nature = TransactionNature.reconstitute('expense');
      expect(nature.getValue()).toBe('expense');
      expect(nature.isExpense()).toBe(true);
    });

    it('should trust database data without normalization or validation', () => {
      // reconstitute expects data to be exactly as stored (lowercase)
      // It just bypasses validation
      const nature = TransactionNature.reconstitute('income');
      expect(nature.getValue()).toBe('income');
    });
  });

  describe('isIncome', () => {
    it('should return true for income nature', () => {
      const nature = TransactionNature.create('income');
      expect(nature.isIncome()).toBe(true);
    });

    it('should return false for expense nature', () => {
      const nature = TransactionNature.create('expense');
      expect(nature.isIncome()).toBe(false);
    });

    it('should work with different case inputs after normalization', () => {
      const nature = TransactionNature.create('INCOME');
      expect(nature.isIncome()).toBe(true);
    });
  });

  describe('isExpense', () => {
    it('should return true for expense nature', () => {
      const nature = TransactionNature.create('expense');
      expect(nature.isExpense()).toBe(true);
    });

    it('should return false for income nature', () => {
      const nature = TransactionNature.create('income');
      expect(nature.isExpense()).toBe(false);
    });

    it('should work with different case inputs after normalization', () => {
      const nature = TransactionNature.create('EXPENSE');
      expect(nature.isExpense()).toBe(true);
    });
  });

  describe('equals', () => {
    it('should return true when natures are equal', () => {
      const nature1 = TransactionNature.create('income');
      const nature2 = TransactionNature.create('income');

      expect(nature1.equals(nature2)).toBe(true);
    });

    it('should return true even with different input cases', () => {
      const nature1 = TransactionNature.create('INCOME');
      const nature2 = TransactionNature.create('income');

      expect(nature1.equals(nature2)).toBe(true);
    });

    it('should return false when natures are different', () => {
      const income = TransactionNature.create('income');
      const expense = TransactionNature.create('expense');

      expect(income.equals(expense)).toBe(false);
    });

    it('should compare reconstituted and created instances correctly', () => {
      const created = TransactionNature.create('expense');
      const reconstituted = TransactionNature.reconstitute('expense');

      expect(created.equals(reconstituted)).toBe(true);
    });
  });

  describe('getValue', () => {
    it('should return "income" for income nature', () => {
      const nature = TransactionNature.create('income');
      expect(nature.getValue()).toBe('income');
    });

    it('should return "expense" for expense nature', () => {
      const nature = TransactionNature.create('expense');
      expect(nature.getValue()).toBe('expense');
    });

    it('should always return lowercase normalized value', () => {
      const upperCase = TransactionNature.create('INCOME');
      expect(upperCase.getValue()).toBe('income');

      const whitespace = TransactionNature.create('  expense  ');
      expect(whitespace.getValue()).toBe('expense');
    });
  });

  describe('difference from CategoryNature', () => {
    it('should have separate validation logic from CategoryNature', () => {
      // TransactionNature throws EmptyTransactionNatureException
      // CategoryNature throws InvalidCategoryNatureException for both empty and invalid

      expect(() => TransactionNature.create('')).toThrow(
        EmptyTransactionNatureException,
      );

      expect(() => TransactionNature.create('invalid')).toThrow(
        InvalidTransactionNatureException,
      );
    });
  });
});
