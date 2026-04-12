import { Amount } from './amount.vo';
import { InvalidAmountException } from '../exceptions/transaction.exceptions';

describe('Amount', () => {
  describe('create', () => {
    it('should create an amount with positive integer', () => {
      const amount = Amount.create(100);
      expect(amount.getValue()).toBe(100);
    });

    it('should create an amount with value 1 (minimum valid)', () => {
      const amount = Amount.create(1);
      expect(amount.getValue()).toBe(1);
    });

    it('should throw InvalidAmountException if amount is zero', () => {
      expect(() => Amount.create(0)).toThrow(InvalidAmountException);
    });

    it('should throw InvalidAmountException if amount is negative', () => {
      expect(() => Amount.create(-1)).toThrow(InvalidAmountException);
      expect(() => Amount.create(-100)).toThrow(InvalidAmountException);
    });

    it('should throw InvalidAmountException if amount is not finite (NaN)', () => {
      expect(() => Amount.create(Number.NaN)).toThrow(InvalidAmountException);
    });

    it('should throw InvalidAmountException if amount is not finite (Infinity)', () => {
      expect(() => Amount.create(Number.POSITIVE_INFINITY)).toThrow(
        InvalidAmountException,
      );
      expect(() => Amount.create(Number.NEGATIVE_INFINITY)).toThrow(
        InvalidAmountException,
      );
    });

    it('should throw InvalidAmountException if amount is not integer (decimal)', () => {
      expect(() => Amount.create(1.5)).toThrow(InvalidAmountException);
      expect(() => Amount.create(0.1)).toThrow(InvalidAmountException);
      expect(() => Amount.create(99.99)).toThrow(InvalidAmountException);
    });

    it('should validate in order: finite -> integer -> positive', () => {
      // NaN fails on finite check
      expect(() => Amount.create(Number.NaN)).toThrow(InvalidAmountException);

      // Decimal fails on integer check (after finite passes)
      expect(() => Amount.create(1.5)).toThrow(InvalidAmountException);

      // Zero fails on positive check (after finite and integer pass)
      expect(() => Amount.create(0)).toThrow(InvalidAmountException);
    });

    it('should require strictly positive (> 0), not >= 0', () => {
      // Zero is explicitly NOT allowed (unlike Balance)
      expect(() => Amount.create(0)).toThrow(InvalidAmountException);

      // Positive values are allowed
      expect(() => Amount.create(1)).not.toThrow();
    });

    it('should handle large positive amounts', () => {
      const largeAmount = Amount.create(999999999);
      expect(largeAmount.getValue()).toBe(999999999);
    });
  });

  describe('reconstitute', () => {
    it('should reconstitute an amount from database without validation', () => {
      const amount = Amount.reconstitute(5000);
      expect(amount.getValue()).toBe(5000);
    });

    it('should reconstitute any positive value without throwing', () => {
      const amount = Amount.reconstitute(1);
      expect(amount.getValue()).toBe(1);
    });

    it('should skip validation - trusts database', () => {
      // reconstitute bypasses validation
      const amount = Amount.reconstitute(500);
      expect(amount.getValue()).toBe(500);
    });
  });

  describe('equals', () => {
    it('should return true when amounts have same value', () => {
      const amount1 = Amount.create(1000);
      const amount2 = Amount.create(1000);

      expect(amount1.equals(amount2)).toBe(true);
    });

    it('should return false when amounts have different values', () => {
      const amount1 = Amount.create(1000);
      const amount2 = Amount.create(500);

      expect(amount1.equals(amount2)).toBe(false);
    });

    it('should return true comparing created and reconstituted with same value', () => {
      const created = Amount.create(2000);
      const reconstituted = Amount.reconstitute(2000);

      expect(created.equals(reconstituted)).toBe(true);
    });

    it('should return false for different values', () => {
      const amount1 = Amount.create(1);
      const amount2 = Amount.create(2);

      expect(amount1.equals(amount2)).toBe(false);
    });
  });

  describe('getValue', () => {
    it('should return the numeric value', () => {
      const amount = Amount.create(12345);
      expect(amount.getValue()).toBe(12345);
    });

    it('should return value 1', () => {
      const amount = Amount.create(1);
      expect(amount.getValue()).toBe(1);
    });

    it('should return large values', () => {
      const amount = Amount.create(999999999);
      expect(amount.getValue()).toBe(999999999);
    });
  });

  describe('difference from Balance', () => {
    it('should reject zero while Balance allows it', () => {
      // Amount rejects zero
      expect(() => Amount.create(0)).toThrow(InvalidAmountException);

      // This is intentional: transactions must be > 0
    });

    it('should enforce strictly positive values (> 0)', () => {
      // Amount requires > 0
      expect(() => Amount.create(1)).not.toThrow();
      expect(() => Amount.create(0)).toThrow();
      expect(() => Amount.create(-1)).toThrow();
    });
  });
});
