import { EntityManager, QueryRunner } from 'typeorm';
import { IExpenseChecker } from '../../domain/ports/expense-checker.port';
import { monthPeriod } from '../../../../shared/domain/month-period';

// ── Scoped checker — private to this file; only the factory below constructs it ──
//
// Runs on the EntityManager of the ACTIVE QueryRunner, so every read happens
// inside the transaction the caller's UoW opened. See the factory below for
// why that precondition is enforced.

class ScopedExpenseChecker extends IExpenseChecker {
  constructor(private readonly manager: EntityManager) {
    super();
  }

  async hasExpensesInPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<boolean> {
    const { start, end } = monthPeriod(year, month);
    const raw = await this.manager
      .createQueryBuilder()
      .select('COUNT(*)', 'cnt')
      .from('v_period_expenses', 'e')
      .where('e.user_id = :userId', { userId })
      .andWhere('e.category_id = :categoryId', { categoryId })
      .andWhere('e.transaction_date >= :start', { start })
      .andWhere('e.transaction_date < :end', { end })
      // NO LOCK: Postgres forbids pessimistic locks on aggregates (COUNT).
      // Serialization against CreateTransaction is guaranteed by the budget-row
      // lock that DeleteBudgetUseCase takes BEFORE calling this checker. Locking
      // existing rows wouldn't stop phantom inserts anyway.
      // Reads FROM v_period_expenses (shared expense definition) on the same
      // this.manager → same transaction; the view inlines, lock model unchanged.
      // COUNT(*) replaces getCount() because a raw-table query builder has no
      // entity metadata; the semantics are identical.
      .getRawOne<{ cnt: string }>();
    return Number(raw?.cnt ?? 0) > 0;
  }

  async sumExpenseAmountInPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<number> {
    const { start, end } = monthPeriod(year, month);
    const raw = await this.manager
      .createQueryBuilder()
      .select('COALESCE(SUM(e.amount), 0)', 'total')
      .from('v_period_expenses', 'e')
      .where('e.user_id = :userId', { userId })
      .andWhere('e.category_id = :categoryId', { categoryId })
      .andWhere('e.transaction_date >= :start', { start })
      .andWhere('e.transaction_date < :end', { end })
      // NO LOCK: Postgres forbids pessimistic locks on aggregates (SUM).
      // Serialization against CreateTransaction is guaranteed by the budget-row
      // lock that UpdateBudgetLimitUseCase takes BEFORE calling this checker.
      // Reads FROM v_period_expenses (shared expense definition) on the same
      // this.manager → same transaction; the view inlines, lock model unchanged.
      .getRawOne<{ total: string }>();
    return Number(raw?.total ?? 0);
  }
}

// ── Factory — the only way to obtain a ScopedExpenseChecker ───────────────────
//
// Takes a QueryRunner (not an EntityManager / DataSource) on purpose: a
// `dataSource.manager` is not a QueryRunner, so passing it stops compiling. This
// moves the "must be transactional" precondition from a runtime guard to a
// compile-time one for the common misuse (autocommit via the global DataSource).
// It still can't catch a QueryRunner that's connected but never started a
// transaction, so we validate that here too — reading an aggregate without an
// open transaction wouldn't be wrong per se, but it would silently defeat the
// serialization guarantee the caller (DeleteBudget / UpdateBudgetLimit) relies
// on: that this read happens under the budget-row lock it took first.
export function createScopedExpenseChecker(
  queryRunner: QueryRunner,
): IExpenseChecker {
  if (queryRunner.isReleased || !queryRunner.isTransactionActive) {
    throw new Error(
      'createScopedExpenseChecker requires a QueryRunner with an active transaction: ' +
        'its consistency guarantee (the budget-row lock taken by the caller) has no effect otherwise.',
    );
  }
  return new ScopedExpenseChecker(queryRunner.manager);
}
