import { Balance } from './balance.vo';
import {
  InvalidBalanceException,
  InsufficientFundsException,
} from '../exceptions/account.exceptions';

describe('Balance', () => {
  describe('create', () => {
    it('should create a balance with positive integer amount', () => {
      const balance = Balance.create(100);
      expect(balance.getValue()).toBe(100);
    });

    it('should create a balance with zero amount', () => {
      const balance = Balance.create(0);
      expect(balance.getValue()).toBe(0);
      expect(balance.isZero()).toBe(true);
    });

    it('should throw InvalidBalanceException if amount is not finite (NaN)', () => {
      expect(() => Balance.create(Number.NaN)).toThrow(InvalidBalanceException);
    });

    it('should throw InvalidBalanceException if amount is not finite (Infinity)', () => {
      expect(() => Balance.create(Number.POSITIVE_INFINITY)).toThrow(
        InvalidBalanceException,
      );
      expect(() => Balance.create(Number.NEGATIVE_INFINITY)).toThrow(
        InvalidBalanceException,
      );
    });

    it('should throw InvalidBalanceException if amount is negative', () => {
      expect(() => Balance.create(-1)).toThrow(InvalidBalanceException);
      expect(() => Balance.create(-100)).toThrow(InvalidBalanceException);
    });

    it('should throw InvalidBalanceException if amount is not integer (decimal)', () => {
      expect(() => Balance.create(1.5)).toThrow(InvalidBalanceException);
      expect(() => Balance.create(0.1)).toThrow(InvalidBalanceException);
      expect(() => Balance.create(99.99)).toThrow(InvalidBalanceException);
    });
  });

  describe('zero', () => {
    it('should return a balance with zero value', () => {
      const zeroBalance = Balance.zero();
      expect(zeroBalance.getValue()).toBe(0);
    });

    it('should bypass all validations', () => {
      // zero() directly uses the private constructor, no validation
      const balance = Balance.zero();
      expect(balance.isZero()).toBe(true);
    });
  });

  describe('reconstitute', () => {
    it('should reconstitute a balance from persisted data without validation', () => {
      // reconstitute bypasses validation (trusts the database)
      const balance = Balance.reconstitute(500);
      expect(balance.getValue()).toBe(500);
    });

    it('should reconstitute zero balance', () => {
      const balance = Balance.reconstitute(0);
      expect(balance.getValue()).toBe(0);
    });
  });

  describe('add', () => {
    it('should add two positive balances', () => {
      const balance1 = Balance.create(100);
      const balance2 = Balance.create(50);
      const result = balance1.add(balance2);

      expect(result.getValue()).toBe(150);
    });

    it('should add balance to zero balance', () => {
      const balance = Balance.create(0);
      const amount = Balance.create(100);
      const result = balance.add(amount);

      expect(result.getValue()).toBe(100);
    });

    it('should add zero to a balance', () => {
      const balance = Balance.create(100);
      const zero = Balance.zero();
      const result = balance.add(zero);

      expect(result.getValue()).toBe(100);
    });
  });

  describe('subtract', () => {
    it('should subtract when there are sufficient funds', () => {
      const balance = Balance.create(100);
      const toSubtract = Balance.create(30);
      const result = balance.subtract(toSubtract);

      expect(result.getValue()).toBe(70);
    });

    it('should subtract exactly the balance amount', () => {
      const balance = Balance.create(100);
      const toSubtract = Balance.create(100);
      const result = balance.subtract(toSubtract);

      expect(result.getValue()).toBe(0);
      expect(result.isZero()).toBe(true);
    });

    it('should throw InsufficientFundsException when subtracting more than balance', () => {
      const balance = Balance.create(50);
      const toSubtract = Balance.create(100);

      expect(() => balance.subtract(toSubtract)).toThrow(InsufficientFundsException);
    });

    it('should throw InsufficientFundsException when subtracting from zero', () => {
      const balance = Balance.zero();
      const toSubtract = Balance.create(1);

      expect(() => balance.subtract(toSubtract)).toThrow(InsufficientFundsException);
    });

    it('should not throw when subtracting zero', () => {
      const balance = Balance.create(100);
      const zero = Balance.zero();

      expect(() => balance.subtract(zero)).not.toThrow();
      const result = balance.subtract(zero);
      expect(result.getValue()).toBe(100);
    });
  });

  describe('equals', () => {
    it('should return true when balances have the same value', () => {
      const balance1 = Balance.create(100);
      const balance2 = Balance.create(100);

      expect(balance1.equals(balance2)).toBe(true);
    });

    it('should return false when balances have different values', () => {
      const balance1 = Balance.create(100);
      const balance2 = Balance.create(50);

      expect(balance1.equals(balance2)).toBe(false);
    });

    it('should return true when both are zero', () => {
      const balance1 = Balance.zero();
      const balance2 = Balance.zero();

      expect(balance1.equals(balance2)).toBe(true);
    });
  });

  describe('greaterThan', () => {
    it('should return true when balance is greater than other', () => {
      const balance = Balance.create(100);
      const other = Balance.create(50);

      expect(balance.greaterThan(other)).toBe(true);
    });

    it('should return false when balance is equal to other', () => {
      const balance = Balance.create(100);
      const other = Balance.create(100);

      expect(balance.greaterThan(other)).toBe(false);
    });

    it('should return false when balance is less than other', () => {
      const balance = Balance.create(50);
      const other = Balance.create(100);

      expect(balance.greaterThan(other)).toBe(false);
    });

    it('should compare zero correctly', () => {
      const balance = Balance.create(0);
      const other = Balance.create(1);

      expect(balance.greaterThan(other)).toBe(false);
      expect(other.greaterThan(balance)).toBe(true);
    });
  });

  describe('isZero', () => {
    it('should return true when balance is zero', () => {
      const balance = Balance.zero();
      expect(balance.isZero()).toBe(true);
    });

    it('should return false when balance is positive', () => {
      const balance = Balance.create(1);
      expect(balance.isZero()).toBe(false);

      const largeBalance = Balance.create(1000);
      expect(largeBalance.isZero()).toBe(false);
    });
  });

  describe('getValue', () => {
    it('should return the numeric value of the balance', () => {
      const balance = Balance.create(12345);
      expect(balance.getValue()).toBe(12345);
    });

    it('should return zero for zero balance', () => {
      const balance = Balance.zero();
      expect(balance.getValue()).toBe(0);
    });
  });

  describe('toString', () => {
    it('should convert balance to string representation', () => {
      const balance = Balance.create(100);
      expect(balance.toString()).toBe('100');
    });

    it('should convert zero balance to string', () => {
      const balance = Balance.zero();
      expect(balance.toString()).toBe('0');
    });
  });
});
