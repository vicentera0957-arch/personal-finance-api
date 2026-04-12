import { Budget } from './budget.entity';
import { AmountLimit } from './amountlimit.vo';
import {
  InvalidBudgetMonthException,
  InvalidBudgetYearException,
} from './exceptions/budget.exceptions';

describe('Budget', () => {
  const createValidBudget = (overrides?: Partial<any>) => {
    return Budget.create({
      id: 'budget-123',
      userId: 'user-1',
      categoryId: 'category-1',
      month: 3,
      year: 2024,
      limit: AmountLimit.create(5000),
      ...overrides,
    });
  };

  describe('create', () => {
    it('should create a budget with valid month and year', () => {
      const budget = createValidBudget();

      expect(budget.id).toBe('budget-123');
      expect(budget.userId).toBe('user-1');
      expect(budget.categoryId).toBe('category-1');
      expect(budget.month).toBe(3);
      expect(budget.year).toBe(2024);
      expect(budget.getLimit().getValue()).toBe(5000);
    });

    it('should set createdAt and updatedAt to now', () => {
      const beforeCreation = new Date();
      const budget = createValidBudget();
      const afterCreation = new Date();

      expect(budget.createdAt.getTime()).toBeGreaterThanOrEqual(
        beforeCreation.getTime(),
      );
      expect(budget.createdAt.getTime()).toBeLessThanOrEqual(
        afterCreation.getTime(),
      );
      expect(budget.getUpdatedAt()).toEqual(budget.createdAt);
    });

    it('should accept all valid months (1-12)', () => {
      for (let month = 1; month <= 12; month++) {
        const budget = createValidBudget({ month });
        expect(budget.month).toBe(month);
      }
    });

    it('should accept any positive year', () => {
      const budget1 = createValidBudget({ year: 1 });
      expect(budget1.year).toBe(1);

      const budget2 = createValidBudget({ year: 2024 });
      expect(budget2.year).toBe(2024);

      const budget3 = createValidBudget({ year: 9999 });
      expect(budget3.year).toBe(9999);
    });

    it('should throw InvalidBudgetMonthException if month is not integer', () => {
      expect(() =>
        createValidBudget({ month: 1.5 }),
      ).toThrow(InvalidBudgetMonthException);
    });

    it('should throw InvalidBudgetMonthException if month is less than 1', () => {
      expect(() =>
        createValidBudget({ month: 0 }),
      ).toThrow(InvalidBudgetMonthException);
      expect(() =>
        createValidBudget({ month: -1 }),
      ).toThrow(InvalidBudgetMonthException);
    });

    it('should throw InvalidBudgetMonthException if month is greater than 12', () => {
      expect(() =>
        createValidBudget({ month: 13 }),
      ).toThrow(InvalidBudgetMonthException);
      expect(() =>
        createValidBudget({ month: 100 }),
      ).toThrow(InvalidBudgetMonthException);
    });

    it('should throw InvalidBudgetYearException if year is not integer', () => {
      expect(() =>
        createValidBudget({ year: 2024.5 }),
      ).toThrow(InvalidBudgetYearException);
    });

    it('should throw InvalidBudgetYearException if year is zero', () => {
      expect(() =>
        createValidBudget({ year: 0 }),
      ).toThrow(InvalidBudgetYearException);
    });

    it('should throw InvalidBudgetYearException if year is negative', () => {
      expect(() =>
        createValidBudget({ year: -1 }),
      ).toThrow(InvalidBudgetYearException);
      expect(() =>
        createValidBudget({ year: -2024 }),
      ).toThrow(InvalidBudgetYearException);
    });

    it('should validate month before year', () => {
      // When both are invalid, month exception is thrown first
      expect(() =>
        createValidBudget({ month: 13, year: 0 }),
      ).toThrow(InvalidBudgetMonthException);
    });
  });

  describe('reconstitute', () => {
    it('should reconstitute a budget with preserved dates', () => {
      const createdAt = new Date('2024-01-15');
      const updatedAt = new Date('2024-02-20');

      const budget = Budget.reconstitute({
        id: 'budget-456',
        userId: 'user-2',
        categoryId: 'category-2',
        month: 5,
        year: 2024,
        limit: AmountLimit.create(10000),
        createdAt,
        updatedAt,
      });

      expect(budget.id).toBe('budget-456');
      expect(budget.createdAt).toEqual(createdAt);
      expect(budget.getUpdatedAt()).toEqual(updatedAt);
    });

    it('should preserve exact timestamp milliseconds', () => {
      const createdAt = new Date('2024-01-15T10:30:45.123Z');
      const updatedAt = new Date('2024-02-20T14:45:30.456Z');

      const budget = Budget.reconstitute({
        id: 'budget-789',
        userId: 'user-3',
        categoryId: 'category-3',
        month: 6,
        year: 2024,
        limit: AmountLimit.create(3000),
        createdAt,
        updatedAt,
      });

      expect(budget.createdAt.getTime()).toBe(createdAt.getTime());
      expect(budget.getUpdatedAt().getTime()).toBe(updatedAt.getTime());
    });
  });

  describe('updateLimit', () => {
    it('should update the limit to a new amount', () => {
      const budget = createValidBudget();
      const newLimit = AmountLimit.create(8000);

      budget.updateLimit(newLimit);

      expect(budget.getLimit().getValue()).toBe(8000);
    });

    it('should allow multiple limit updates', () => {
      const budget = createValidBudget();

      budget.updateLimit(AmountLimit.create(5000));
      expect(budget.getLimit().getValue()).toBe(5000);

      budget.updateLimit(AmountLimit.create(7000));
      expect(budget.getLimit().getValue()).toBe(7000);

      budget.updateLimit(AmountLimit.create(3000));
      expect(budget.getLimit().getValue()).toBe(3000);
    });
  });

  describe('getLimit', () => {
    it('should return the current limit', () => {
      const limit = AmountLimit.create(5500);
      const budget = Budget.create({
        id: 'budget-999',
        userId: 'user-4',
        categoryId: 'category-4',
        month: 7,
        year: 2024,
        limit,
      });

      expect(budget.getLimit()).toEqual(limit);
    });
  });

  describe('getUpdatedAt', () => {
    it('should return the updatedAt timestamp', () => {
      const budget = createValidBudget();
      const timestamp = budget.getUpdatedAt();

      expect(timestamp).toBeInstanceOf(Date);
    });
  });

  describe('isForPeriod', () => {
    it('should return true when month and year match', () => {
      const budget = createValidBudget({ month: 3, year: 2024 });

      expect(budget.isForPeriod(3, 2024)).toBe(true);
    });

    it('should return false when month differs', () => {
      const budget = createValidBudget({ month: 3, year: 2024 });

      expect(budget.isForPeriod(4, 2024)).toBe(false);
    });

    it('should return false when year differs', () => {
      const budget = createValidBudget({ month: 3, year: 2024 });

      expect(budget.isForPeriod(3, 2023)).toBe(false);
    });

    it('should return false when both month and year differ', () => {
      const budget = createValidBudget({ month: 3, year: 2024 });

      expect(budget.isForPeriod(6, 2025)).toBe(false);
    });

    it('should distinguish between all months', () => {
      const budget = createValidBudget({ month: 1, year: 2024 });

      for (let month = 2; month <= 12; month++) {
        expect(budget.isForPeriod(month, 2024)).toBe(false);
      }
    });

    it('should distinguish between different years', () => {
      const budget = createValidBudget({ month: 6, year: 2024 });

      expect(budget.isForPeriod(6, 2023)).toBe(false);
      expect(budget.isForPeriod(6, 2025)).toBe(false);
      expect(budget.isForPeriod(6, 2024)).toBe(true);
    });
  });

  describe('readonly properties', () => {
    it('should have immutable id, userId, categoryId, month, year', () => {
      const budget = createValidBudget();

      // These are readonly properties and cannot be meaningfully modified
      // (They are public readonly in TypeScript, enforced at compile-time)
      expect(budget.id).toBe('budget-123');
      expect(budget.userId).toBe('user-1');
      expect(budget.categoryId).toBe('category-1');
      expect(budget.month).toBe(3);
      expect(budget.year).toBe(2024);
    });
  });
});
