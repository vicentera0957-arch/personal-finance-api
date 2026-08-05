import { EntityManager, QueryRunner } from 'typeorm';
import { IScopedBudgetRepository } from '../../domain/repository/scoped-budget.repository';
import { IScopedBudgetPeriodReader } from '../../domain/repository/budget-period-reader.port';
import { Budget } from '../../domain/budget.entity';
import { BudgetOrmEntity } from './budget.orm.entity';
import { BudgetMapper } from './budget.mapper';

// ── Scoped repository — private to this file; only the factory below constructs it ──
//
// Runs on the EntityManager of the ACTIVE QueryRunner, so every read/write happens
// inside the transaction the caller's UoW opened. Key fact about the FOR UPDATE lock
// below: a pessimistic row lock is held until the TRANSACTION commits or rolls back —
// NOT until the findOne call returns. The method returns the row, but the lock stays
// for the whole begin()→commit() window, covering the later write. (If this ran on the
// global DataSource in autocommit, the lock would be released right after the SELECT
// and would be useless — hence scoped repos only, built from a QueryRunner with an
// active transaction.)

class ScopedBudgetRepository
  extends IScopedBudgetRepository
  implements IScopedBudgetPeriodReader
{
  constructor(
    private readonly manager: EntityManager,
    private readonly mapper: BudgetMapper,
  ) {
    super();
  }

  // LOCK (FOR UPDATE): budget row, held until commit. The "logical mutex" for the
  // period invariant (Σ expenses ≤ limit). Used by UpdateBudgetLimit / DeleteBudget
  // when the budget id is known; serializes them against concurrent expense creates.
  async findByIdWithLock(id: string): Promise<Budget | null> {
    const orm = await this.manager.findOne(BudgetOrmEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    return orm ? this.mapper.toDomain(orm) : null;
  }

  // LOCK (FOR UPDATE): budget row, held until commit. Same logical mutex as
  // findByIdWithLock, but reached by the natural tuple (user, category, month,
  // year) instead of the PK. This is the gate CreateTransaction takes first,
  // before summing period expenses — so both paths converge on the same locked row.
  async findByUserIdAndCategoryIdAndPeriodWithLock(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<Budget | null> {
    const orm = await this.manager.findOne(BudgetOrmEntity, {
      where: { userId, categoryId, month, year },
      lock: { mode: 'pessimistic_write' },
    });
    return orm ? this.mapper.toDomain(orm) : null;
  }

  async save(budget: Budget): Promise<Budget> {
    const orm = this.mapper.toOrm(budget);
    const saved = await this.manager.save(BudgetOrmEntity, orm);
    return this.mapper.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.manager.delete(BudgetOrmEntity, id);
  }
}

// ── Factory — the only way to obtain a ScopedBudgetRepository ─────────────────
//
// Takes a QueryRunner (not an EntityManager / DataSource) on purpose: a
// `dataSource.manager` is not a QueryRunner, so passing it stops compiling. This
// moves the "must be transactional" precondition from a runtime guard to a
// compile-time one for the common misuse (autocommit via the global DataSource).
// It still can't catch a QueryRunner that's connected but never started a
// transaction, so we validate that here too — a FOR UPDATE without an open
// transaction is type-correct but silently pointless.
//
// BudgetUnitOfWorkImpl (UpdateBudgetLimit, DeleteBudget) is the only caller:
// it owns the Budget aggregate, so it gets the full read/write surface.
export function createScopedBudgetRepository(
  queryRunner: QueryRunner,
  mapper: BudgetMapper,
): IScopedBudgetRepository {
  if (queryRunner.isReleased || !queryRunner.isTransactionActive) {
    throw new Error(
      'createScopedBudgetRepository requires a QueryRunner with an active transaction: ' +
        'its FOR UPDATE locks have no effect otherwise.',
    );
  }
  return new ScopedBudgetRepository(queryRunner.manager, mapper);
}

// TypeOrmUnitOfWorkImpl (CreateTransaction) is the only caller: it only locks
// the budget row before summing period expenses, on its OWN QueryRunner — it
// never writes a budget. Same underlying class as createScopedBudgetRepository
// above (zero duplicated SQL / FOR UPDATE), narrowed to a read-only view.
export function createScopedBudgetPeriodReader(
  queryRunner: QueryRunner,
  mapper: BudgetMapper,
): IScopedBudgetPeriodReader {
  if (queryRunner.isReleased || !queryRunner.isTransactionActive) {
    throw new Error(
      'createScopedBudgetPeriodReader requires a QueryRunner with an active transaction: ' +
        'its FOR UPDATE locks have no effect otherwise.',
    );
  }
  return new ScopedBudgetRepository(queryRunner.manager, mapper);
}
