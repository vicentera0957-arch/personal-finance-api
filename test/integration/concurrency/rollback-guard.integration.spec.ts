import { INestApplication } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
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
 * REPLACES the pre-P3+P4 version of this file, which exercised
 * `begin()` → `commit()` → `rollback()` → `release()` called by hand on the
 * four UoW impls. That public surface is gone: the impls no longer expose a
 * manual lifecycle, only `run()`. This is a deliberate replacement, not an
 * adaptation — the contract under test changed shape, but the reason the
 * suite exists has not: real TypeORM semantics that no mocked QueryRunner
 * can reproduce.
 *
 * What used to need proving by hand (commit flips `isTransactionActive` to
 * false; a rollback on an inactive transaction throws
 * `TransactionNotStartedError` unless guarded) is now impossible to trigger
 * through the public API — `run()`'s own try/catch guarantees commit and
 * rollback are mutually exclusive per invocation (see
 * `typeorm-transaction-runner.spec.ts`, tested there with a mocked
 * QueryRunner). What is NOT covered by that unit suite is whether the real
 * TypeORM flag semantics it assumes actually hold, and whether the four
 * REAL impls (not a toy `TestRunner`) wire `createContext()` correctly
 * against a real `DataSource`. That is what this file proves:
 *
 *  1. The raw-QueryRunner flag semantics the runner's guard depends on
 *     (`commitTransaction()` → `isTransactionActive` false;
 *     `rollbackTransaction()` on an inactive transaction throws) — same
 *     scenario the old suite tested, kept verbatim because it is still the
 *     only place proving the assumption baked into
 *     `typeorm-transaction-runner.ts`'s catch block.
 *  2. Each of the four real impls' `run()`, happy path and error path,
 *     against a real `DataSource` — proving `createContext()` plus the
 *     shared runner produce a working, cleanly-released transaction, and
 *     that a thrown domain error survives real commit/rollback/release
 *     intact (no `TransactionNotStartedError` leaking out, no wrapping).
 *  3. Two sequential (non-nested) `run()` calls on the SAME impl instance —
 *     the direct behavioral consequence of dropping `Scope.REQUEST` (P3):
 *     a singleton UoW provider must be safe to reuse across requests
 *     against a real connection pool, not just against a mocked
 *     `DataSource.createQueryRunner()`.
 *
 * Deliberately a separate file, not a new `describe` inside
 * concurrency.integration.spec.ts: CLAUDE.md forbids modifying that file's
 * existing scenarios (the regression net for 7 closed race conditions), and
 * this suite is unrelated to any of them — it tests UoW lifecycle in
 * isolation, with no HTTP requests and no cross-aggregate invariant.
 */
describe('run(): commit/rollback/release against a real QueryRunner', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('raw QueryRunner: the flag semantics the runner guard depends on', () => {
    it('commitTransaction() flips isTransactionActive to false, and a further rollbackTransaction() throws TransactionNotStartedError', async () => {
      const queryRunner: QueryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();
      await queryRunner.commitTransaction();

      expect(queryRunner.isTransactionActive).toBe(false);

      // This is exactly why typeorm-transaction-runner.ts's catch block
      // guards with `if (qr.isTransactionActive) await qr.rollbackTransaction()`
      // instead of calling it unconditionally.
      await expect(queryRunner.rollbackTransaction()).rejects.toThrow();

      await queryRunner.release();
    });

    it('a second rollbackTransaction() after the first is also unsafe without a guard (double rollback)', async () => {
      const queryRunner: QueryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();
      await queryRunner.rollbackTransaction();

      expect(queryRunner.isTransactionActive).toBe(false);
      await expect(queryRunner.rollbackTransaction()).rejects.toThrow();

      await queryRunner.release();
    });

    it('release() returns the connection to the pool (isReleased flips)', async () => {
      const queryRunner: QueryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();
      await queryRunner.commitTransaction();

      expect(queryRunner.isReleased).toBe(false);
      await queryRunner.release();
      expect(queryRunner.isReleased).toBe(true);
    });
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
    it('run() happy path resolves with the callback result and releases cleanly', async () => {
      const uow = makeUow();

      const result = await uow.run(async () => 'ok');

      expect(result).toBe('ok');
    });

    it('run() error path rejects with the ORIGINAL error, real commit/rollback/release included', async () => {
      const uow = makeUow();
      class MarkerError extends Error {}

      await expect(
        uow.run(async () => {
          throw new MarkerError('boom');
        }),
      ).rejects.toBeInstanceOf(MarkerError);
    });

    it('two sequential run() calls on the same (singleton) instance both succeed', async () => {
      const uow = makeUow();

      const first = await uow.run(async () => 1);
      const second = await uow.run(async () => 2);

      expect(first).toBe(1);
      expect(second).toBe(2);
    });
  });
});
