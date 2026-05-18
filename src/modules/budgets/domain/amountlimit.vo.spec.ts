import { AmountLimit } from './amountlimit.vo';
import { InvalidAmountLimitException } from './exceptions/budget.exceptions';

describe('AmountLimit', () => {
  describe('create', () => {
    it('should create an amount limit with positive integer', () => {
      const limit = AmountLimit.create(1000);
      expect(limit.getValue()).toBe(1000);
    });

    it('should create an amount limit with value 1', () => {
      const limit = AmountLimit.create(1);
      expect(limit.getValue()).toBe(1);
    });

    it('should throw InvalidAmountLimitException if amount is not finite (NaN)', () => {
      expect(() => AmountLimit.create(Number.NaN)).toThrow(
        InvalidAmountLimitException,
      );
    });

    it('should throw InvalidAmountLimitException if amount is not finite (Infinity)', () => {
      expect(() => AmountLimit.create(Number.POSITIVE_INFINITY)).toThrow(
        InvalidAmountLimitException,
      );
      expect(() => AmountLimit.create(Number.NEGATIVE_INFINITY)).toThrow(
        InvalidAmountLimitException,
      );
    });

    it('should throw InvalidAmountLimitException if amount is not integer (decimal)', () => {
      expect(() => AmountLimit.create(1.5)).toThrow(
        InvalidAmountLimitException,
      );
      expect(() => AmountLimit.create(0.1)).toThrow(
        InvalidAmountLimitException,
      );
      expect(() => AmountLimit.create(999.99)).toThrow(
        InvalidAmountLimitException,
      );
    });

    it('should throw InvalidAmountLimitException if amount is zero', () => {
      expect(() => AmountLimit.create(0)).toThrow(InvalidAmountLimitException);
    });

    it('should throw InvalidAmountLimitException if amount is negative', () => {
      expect(() => AmountLimit.create(-1)).toThrow(InvalidAmountLimitException);
      expect(() => AmountLimit.create(-100)).toThrow(
        InvalidAmountLimitException,
      );
    });

    it('should validate in order: finite -> integer -> positive', () => {
      // NaN fails on finite check
      expect(() => AmountLimit.create(Number.NaN)).toThrow(
        InvalidAmountLimitException,
      );

      // Decimal fails on integer check (after finite passes)
      expect(() => AmountLimit.create(1.5)).toThrow(
        InvalidAmountLimitException,
      );

      // Zero fails on positive check (after finite and integer pass)
      expect(() => AmountLimit.create(0)).toThrow(InvalidAmountLimitException);
    });
  });

  describe('reconstitute', () => {
    it('should reconstitute an amount limit from database without validation', () => {
      const limit = AmountLimit.reconstitute(5000);
      expect(limit.getValue()).toBe(5000);
    });

    it('should reconstitute any value without throwing', () => {
      // reconstitute skips validation, trusts the database
      const limit = AmountLimit.reconstitute(1);
      expect(limit.getValue()).toBe(1);
    });
  });

  describe('equals', () => {
    it('should return true when limits have same value', () => {
      const limit1 = AmountLimit.create(1000);
      const limit2 = AmountLimit.create(1000);

      expect(limit1.equals(limit2)).toBe(true);
    });

    it('should return false when limits have different values', () => {
      const limit1 = AmountLimit.create(1000);
      const limit2 = AmountLimit.create(500);

      expect(limit1.equals(limit2)).toBe(false);
    });

    it('should return true when comparing reconstituted and created with same value', () => {
      const created = AmountLimit.create(1500);
      const reconstituted = AmountLimit.reconstitute(1500);

      expect(created.equals(reconstituted)).toBe(true);
    });
  });

  describe('getValue', () => {
    it('should return the numeric value', () => {
      const limit = AmountLimit.create(12345);
      expect(limit.getValue()).toBe(12345);
    });

    it('should return value 1', () => {
      const limit = AmountLimit.create(1);
      expect(limit.getValue()).toBe(1);
    });
  });
});
