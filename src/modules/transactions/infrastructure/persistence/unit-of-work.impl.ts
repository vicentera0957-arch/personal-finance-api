import { Injectable, Scope } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { ITransactionUnitOfWork } from '../../domain/ITransactionUnitOfWork';
import { IBudgetUnitOfWork } from '../../../budgets/domain/IBudgetUnitOfWork';
import { IAccountUnitOfWork } from '../../../accounts/domain/IAccountUnitOfWork';
import { IScopedTransactionRepository } from '../../domain/repository/scoped-transaction.repository';
import { IAccountRepository } from '../../../accounts/domain/repository/accounts.repository';
import { IBudgetRepository } from '../../../budgets/domain/repository/budgets.repository';
import { IExpenseChecker } from '../../../budgets/domain/repository/expense-checker.port';
import { Transaction } from '../../domain/entities/transaction.entity';
import { TransactionOrmEntity } from './transaction.orm.entity';
import { TransactionMapper } from './transaction.mapper';
import { AccountOrmEntity } from '../../../accounts/infrastructure/persistence/account.orm.entity';
import { AccountMapper } from '../../../accounts/infrastructure/persistence/account.mapper';
import { Account } from '../../../accounts/domain/entities/account.entity';
import { BudgetOrmEntity } from '../../../budgets/infrastructure/persistence/budget.orm.entity';
import { BudgetMapper } from '../../../budgets/infrastructure/persistence/budget.mapper';
import { Budget } from '../../../budgets/domain/budget.entity';
import { monthPeriod } from '../../../../shared/domain/month-period';

// ── Scoped repositories — private to this file; only the UoW constructs them ──
//
// Each runs on the EntityManager of the ACTIVE QueryRunner, so every read/write
// happens inside the transaction the UoW opened. Key fact about the FOR UPDATE
// locks below: a pessimistic row lock is held until the TRANSACTION commits or
// rolls back — NOT until the findOne call returns. The method returns the row,
// but the lock stays for the whole begin()→commit() window, covering the later
// write. (If these ran on the global DataSource in autocommit, the lock would be
// released right after the SELECT and would be useless — hence scoped repos only.)

class ScopedTransactionRepository extends IScopedTransactionRepository {
  constructor(
    private readonly manager: EntityManager,
    private readonly mapper: TransactionMapper,
  ) {
    super();
  }

  // LOCK (FOR UPDATE): transaction row, held until commit. Serializes two
  // concurrent DELETE /transactions/:id on the same row — the second arrival
  // blocks here, then sees null after the first commits and throws
  // TransactionNotFound, preventing a double-reverse of the balance (Race 3).
  async findByIdWithLock(id: string): Promise<Transaction | null> {
    const orm = await this.manager.findOne(TransactionOrmEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    return orm ? this.mapper.toDomain(orm) : null;
  }

  async save(transaction: Transaction): Promise<Transaction> {
    const orm = this.mapper.toOrm(transaction);
    const saved = await this.manager.save(TransactionOrmEntity, orm);
    return this.mapper.toDomain(saved);
  }

  async sumExpenseAmountByUserCategoryAndPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<number> {
    const { start, end } = monthPeriod(year, month);

    // NO LOCK: aggregate read. Serialization is guaranteed by the pessimistic
    // lock on the budget row taken in findByUserIdAndCategoryIdAndPeriod, which
    // CreateTransactionUseCase acquires BEFORE calling this sum.
    // No one can commit a new expense for THIS budget/period while we hold its row
    // lock, so this aggregate stays consistent through commit — no lock needed here.
    // A FOR UPDATE here would add no correctness (locking existing rows can't block
    // phantom inserts into the range) and would only contend with unrelated reads.
    //
    // Reads FROM v_period_expenses — the single definition of "expense", shared
    // with reports (GET /reports/summary). Runs on the SAME this.manager (same
    // QueryRunner → same transaction), so the budget-row lock the caller holds
    // still serializes it; the view inlines into the plan, leaving both the
    // execution plan and the lock model unchanged. Columns are raw snake_case:
    // the view carries no entity metadata to map camelCase.
    const raw = await this.manager
      .createQueryBuilder()
      .select('COALESCE(SUM(e.amount), 0)', 'total')
      .from('v_period_expenses', 'e')
      .where('e.user_id = :userId', { userId })
      .andWhere('e.category_id = :categoryId', { categoryId })
      .andWhere('e.transaction_date >= :start', { start })
      .andWhere('e.transaction_date < :end', { end })
      .getRawOne<{ total: string }>();

    return Number(raw?.total ?? 0);
  }

  async delete(id: string): Promise<void> {
    await this.manager.delete(TransactionOrmEntity, id);
  }
}

class ScopedAccountRepository extends IAccountRepository {
  constructor(
    private readonly manager: EntityManager,
    private readonly mapper: AccountMapper,
  ) {
    super();
  }

  // LOCK (FOR UPDATE): account row, held until commit. Serializes every balance
  // mutation on this account — CreateTransaction, DeleteTransaction, and the
  // Archive/Unarchive/Rename use cases all compete for this same row (Race 2).
  async findById(id: string): Promise<Account | null> {
    const orm = await this.manager.findOne(AccountOrmEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    return orm ? this.mapper.toDomain(orm) : null;
  }

  async findByUserId(userId: string): Promise<Account[]> {
    const orms = await this.manager.find(AccountOrmEntity, {
      where: { userId },
    });
    return orms.map((orm) => this.mapper.toDomain(orm));
  }

  async save(account: Account): Promise<Account> {
    const orm = this.mapper.toOrm(account);
    const saved = await this.manager.save(AccountOrmEntity, orm);
    return this.mapper.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.manager.delete(AccountOrmEntity, id);
  }
}

class ScopedBudgetRepository extends IBudgetRepository {
  constructor(
    private readonly manager: EntityManager,
    private readonly mapper: BudgetMapper,
  ) {
    super();
  }

  // LOCK (FOR UPDATE): budget row, held until commit. The "logical mutex" for the
  // period invariant (Σ expenses ≤ limit). Used by UpdateBudgetLimit / DeleteBudget
  // when the budget id is known; serializes them against concurrent expense creates.
  async findById(id: string): Promise<Budget | null> {
    const orm = await this.manager.findOne(BudgetOrmEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    return orm ? this.mapper.toDomain(orm) : null;
  }

  async findByUserId(userId: string): Promise<Budget[]> {
    const orms = await this.manager.find(BudgetOrmEntity, {
      where: { userId },
    });
    return orms.map((orm) => this.mapper.toDomain(orm));
  }

  // LOCK (FOR UPDATE): budget row, held until commit. Same logical mutex as
  // findById, but reached by the natural tuple (user, category, month, year)
  // instead of the PK. This is the gate CreateTransaction takes first, before
  // summing period expenses — so both paths converge on the same locked row.
  async findByUserIdAndCategoryIdAndPeriod(
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

// ── Implementación del UoW ────────────────────────────────────────────────────

/**
 * Single concrete implementation that satisfies BOTH module-specific UoW ports.
 *
 * Wired in NestJS via `useExisting` so `ITransactionUnitOfWork` and
 * `IBudgetUnitOfWork` resolve to the SAME request-scoped instance — sharing
 * one QueryRunner / one DB transaction.
 */
@Injectable({ scope: Scope.REQUEST })
export class TypeOrmUnitOfWorkImpl
  extends ITransactionUnitOfWork
  implements IBudgetUnitOfWork, IAccountUnitOfWork
{
  private queryRunner: QueryRunner | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionMapper: TransactionMapper,
    private readonly accountMapper: AccountMapper,
    private readonly budgetMapper: BudgetMapper,
  ) {
    super();
  }
  // uow methods — begin, commit, rollback, release, isActive
  async begin(): Promise<void> {
    //reserves a connection
    this.queryRunner = this.dataSource.createQueryRunner();
    await this.queryRunner.connect();
    await this.queryRunner.startTransaction();
  }

  async commit(): Promise<void> {
    await this.queryRunner?.commitTransaction();
  }

  async rollback(): Promise<void> {
    await this.queryRunner?.rollbackTransaction();
  }

  async release(): Promise<void> {
    await this.queryRunner?.release();
    this.queryRunner = null;
  }

  isActive(): boolean {
    return this.queryRunner !== null;
  }
  // repository getters — return SCOPED repositories that share the same Conection/Transaction via the QueryRunner.
  getScopedTransactionRepository(): IScopedTransactionRepository {
    return new ScopedTransactionRepository(
      this.queryRunner!.manager,
      this.transactionMapper,
    );
  }

  getScopedAccountRepository(): IAccountRepository {
    return new ScopedAccountRepository(
      this.queryRunner!.manager,
      this.accountMapper,
    );
  }

  getScopedBudgetRepository(): IBudgetRepository {
    return new ScopedBudgetRepository(
      this.queryRunner!.manager,
      this.budgetMapper,
    );
  }

  getScopedExpenseChecker(): IExpenseChecker {
    return new ScopedExpenseChecker(this.queryRunner!.manager);
  }
}
