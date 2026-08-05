import { QueryRunner } from 'typeorm';
import { createScopedAccountRepository } from './scoped-account.repository';
import { AccountOrmEntity } from './account.orm.entity';
import { AccountMapper } from './account.mapper';

describe('createScopedAccountRepository', () => {
  it('takes FOR UPDATE when reading by id', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const queryRunner = {
      isReleased: false,
      isTransactionActive: true,
      manager: { findOne },
    } as unknown as QueryRunner;

    const repo = createScopedAccountRepository(
      queryRunner,
      new AccountMapper(),
    );
    await repo.findByIdWithLock('a1');

    expect(findOne).toHaveBeenCalledWith(AccountOrmEntity, {
      where: { id: 'a1' },
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
      createScopedAccountRepository(queryRunner, new AccountMapper()),
    ).toThrow();
  });

  it('rejects a released QueryRunner', () => {
    const queryRunner = {
      isReleased: true,
      isTransactionActive: true,
      manager: { findOne: jest.fn() },
    } as unknown as QueryRunner;

    expect(() =>
      createScopedAccountRepository(queryRunner, new AccountMapper()),
    ).toThrow();
  });
});
