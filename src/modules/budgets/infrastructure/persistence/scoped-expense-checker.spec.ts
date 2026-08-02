import { QueryRunner } from 'typeorm';
import { createScopedExpenseChecker } from './scoped-expense-checker';

describe('createScopedExpenseChecker', () => {
  function mockQueryBuilder(rawResult: Record<string, string>) {
    const qb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(rawResult),
    };
    return qb;
  }

  it('hasExpensesInPeriod queries FROM v_period_expenses and takes NO lock', async () => {
    const qb = mockQueryBuilder({ cnt: '2' });
    const createQueryBuilder = jest.fn().mockReturnValue(qb);
    const queryRunner = {
      isReleased: false,
      isTransactionActive: true,
      manager: { createQueryBuilder },
    } as unknown as QueryRunner;

    const checker = createScopedExpenseChecker(queryRunner);
    const result = await checker.hasExpensesInPeriod('u1', 'c1', 6, 2026);

    expect(qb.from).toHaveBeenCalledWith('v_period_expenses', 'e');
    // Postgres forbids FOR UPDATE on aggregates: no `.setLock` / lock option anywhere in the chain.
    expect(qb).not.toHaveProperty('setLock');
    expect(result).toBe(true);
  });

  it('sumExpenseAmountInPeriod queries FROM v_period_expenses and takes NO lock', async () => {
    const qb = mockQueryBuilder({ total: '15000' });
    const createQueryBuilder = jest.fn().mockReturnValue(qb);
    const queryRunner = {
      isReleased: false,
      isTransactionActive: true,
      manager: { createQueryBuilder },
    } as unknown as QueryRunner;

    const checker = createScopedExpenseChecker(queryRunner);
    const result = await checker.sumExpenseAmountInPeriod('u1', 'c1', 6, 2026);

    expect(qb.from).toHaveBeenCalledWith('v_period_expenses', 'e');
    expect(qb).not.toHaveProperty('setLock');
    expect(result).toBe(15000);
  });

  it('rejects a QueryRunner without an active transaction', () => {
    const queryRunner = {
      isReleased: false,
      isTransactionActive: false,
      manager: { createQueryBuilder: jest.fn() },
    } as unknown as QueryRunner;

    expect(() => createScopedExpenseChecker(queryRunner)).toThrow();
  });

  it('rejects a released QueryRunner', () => {
    const queryRunner = {
      isReleased: true,
      isTransactionActive: true,
      manager: { createQueryBuilder: jest.fn() },
    } as unknown as QueryRunner;

    expect(() => createScopedExpenseChecker(queryRunner)).toThrow();
  });
});
