import { EntityManager } from 'typeorm';
import { sumPeriodExpenses } from './period-expenses.query';

describe('sumPeriodExpenses', () => {
  function mockQueryBuilder(rawResult: Record<string, string> | undefined) {
    const qb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue(rawResult),
    };
    return qb;
  }

  it('queries FROM v_period_expenses with the four (user, category, period) filters and no lock', async () => {
    const qb = mockQueryBuilder({ total: '4200' });
    const manager = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as EntityManager;

    const result = await sumPeriodExpenses(manager, 'u1', 'c1', 6, 2026);

    expect(qb.from).toHaveBeenCalledWith('v_period_expenses', 'e');
    expect(qb.where).toHaveBeenCalledWith('e.user_id = :userId', {
      userId: 'u1',
    });
    expect(qb.andWhere).toHaveBeenCalledWith('e.category_id = :categoryId', {
      categoryId: 'c1',
    });
    expect(qb).not.toHaveProperty('setLock');
    expect(result).toBe(4200);
  });

  it('returns 0 for an empty period', async () => {
    const qb = mockQueryBuilder(undefined);
    const manager = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as EntityManager;

    const result = await sumPeriodExpenses(manager, 'u1', 'c1', 6, 2026);

    expect(result).toBe(0);
  });
});
