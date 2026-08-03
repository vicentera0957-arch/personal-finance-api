import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTestApp } from '../../helpers/app-bootstrap';
import { IUnitOfWork } from '../../../src/shared/domain/IUnitOfWork';
import { TypeOrmUnitOfWorkImpl } from '../../../src/modules/transactions/infrastructure/persistence/unit-of-work.impl';
import { BudgetUnitOfWorkImpl } from '../../../src/modules/budgets/infrastructure/persistence/budget-unit-of-work.impl';
import { AccountUnitOfWorkImpl } from '../../../src/modules/accounts/infrastructure/persistence/account-unit-of-work.impl';
import { AuthUnitOfWorkImpl } from '../../../src/modules/auth/infrastructure/persistence/auth-unit-of-work.impl';
import { TransactionMapper } from '../../../src/modules/transactions/infrastructure/persistence/transaction.mapper';
import { AccountMapper } from '../../../src/modules/accounts/infrastructure/persistence/account.mapper';
import { BudgetMapper } from '../../../src/modules/budgets/infrastructure/persistence/budget.mapper';
import { RefreshTokenMapper } from '../../../src/modules/auth/infrastructure/persistence/refresh-token.mapper';

/**
 * PLAN-P7 §6.6 (Cambio B) — the rollback() guard added to the four UoW impls
 * depends on real TypeORM semantics that no mock can reproduce:
 * commitTransaction() flips QueryRunner.isTransactionActive to false, and
 * rollbackTransaction() reads that flag to decide whether to throw
 * TransactionNotStartedError. This suite exercises that behavior against a
 * real QueryRunner for each of the four concrete impls, so a silent change in
 * a future TypeORM major version fails here instead of masking a real error
 * in production — exactly the bug P7 closes.
 *
 * Deliberately a separate file, not a new `describe` inside
 * concurrency.integration.spec.ts: CLAUDE.md forbids modifying that file's
 * existing scenarios (the regression net for 7 closed race conditions), and
 * this suite is unrelated to any of them — it tests UoW lifecycle in
 * isolation, with no HTTP requests and no cross-aggregate invariant.
 */
describe('rollback() guard: post-commit and double-rollback are safe (real QueryRunner)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const impls: Array<[string, () => IUnitOfWork<unknown>]> = [
    [
      'TypeOrmUnitOfWorkImpl (transactions)',
      () =>
        new TypeOrmUnitOfWorkImpl(
          dataSource,
          new TransactionMapper(),
          new AccountMapper(),
          new BudgetMapper(),
        ),
    ],
    [
      'BudgetUnitOfWorkImpl (budgets)',
      () => new BudgetUnitOfWorkImpl(dataSource, new BudgetMapper()),
    ],
    [
      'AccountUnitOfWorkImpl (accounts)',
      () => new AccountUnitOfWorkImpl(dataSource, new AccountMapper()),
    ],
    [
      'AuthUnitOfWorkImpl (auth)',
      () => new AuthUnitOfWorkImpl(dataSource, new RefreshTokenMapper()),
    ],
  ];

  describe.each(impls)('%s', (_name, makeUow) => {
    it('begin() -> commit() -> rollback() does not throw', async () => {
      const uow = makeUow();
      await uow.begin();
      await uow.commit();

      // Before the guard: rollbackTransaction() on an already-committed
      // QueryRunner throws TransactionNotStartedError here.
      await expect(uow.rollback()).resolves.toBeUndefined();

      await uow.release();
    });

    it('begin() -> rollback() -> rollback() does not throw (double rollback, no release in between)', async () => {
      const uow = makeUow();
      await uow.begin();
      await uow.rollback();

      // Same guard, same reasoning: the first rollback already closed the
      // transaction (isTransactionActive=false), so the second is a no-op.
      await expect(uow.rollback()).resolves.toBeUndefined();

      await uow.release();
    });
  });

  it('begin() -> commit() -> release() returns the connection to the pool', async () => {
    // Raw QueryRunner, mirroring what every impl's begin()/commit()/release()
    // do internally — isReleased is TypeORM's own signal that release() gave
    // the connection back. No UoW impl exposes its private QueryRunner, and
    // this fact is identical across the four impls (same three lines of
    // code), so testing it once here is representative.
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    await queryRunner.commitTransaction();

    expect(queryRunner.isReleased).toBe(false);
    await queryRunner.release();
    expect(queryRunner.isReleased).toBe(true);
  });
});
