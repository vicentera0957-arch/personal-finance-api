import { QueryRunner } from 'typeorm';
import { createScopedBudgetRepository } from './scoped-budget.repository';
import { BudgetOrmEntity } from './budget.orm.entity';
import { BudgetMapper } from './budget.mapper';

describe('createScopedBudgetRepository', () => {
  it('takes FOR UPDATE when reading by id', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const queryRunner = {
      isReleased: false,
      isTransactionActive: true,
      manager: { findOne },
    } as unknown as QueryRunner;

    const repo = createScopedBudgetRepository(queryRunner, new BudgetMapper());
    await repo.findById('b1');

    expect(findOne).toHaveBeenCalledWith(BudgetOrmEntity, {
      where: { id: 'b1' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('takes FOR UPDATE when reading by user/category/period', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const queryRunner = {
      isReleased: false,
      isTransactionActive: true,
      manager: { findOne },
    } as unknown as QueryRunner;

    const repo = createScopedBudgetRepository(queryRunner, new BudgetMapper());
    await repo.findByUserIdAndCategoryIdAndPeriod('u1', 'c1', 6, 2026);

    expect(findOne).toHaveBeenCalledWith(BudgetOrmEntity, {
      where: { userId: 'u1', categoryId: 'c1', month: 6, year: 2026 },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('rejects a QueryRunner without an active transaction', () => {
    const queryRunner = {
      isReleased: false,
      isTransactionActive: false,
      manager: { findOne: jest.fn() },
    } as unknown as QueryRunner;

    expect(() =>
      createScopedBudgetRepository(queryRunner, new BudgetMapper()),
    ).toThrow();
  });

  it('rejects a released QueryRunner', () => {
    const queryRunner = {
      isReleased: true,
      isTransactionActive: true,
      manager: { findOne: jest.fn() },
    } as unknown as QueryRunner;

    expect(() =>
      createScopedBudgetRepository(queryRunner, new BudgetMapper()),
    ).toThrow();
  });
});
