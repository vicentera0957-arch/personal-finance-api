import { Injectable, Scope } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  QueryRunner,
  Between,
  MoreThanOrEqual,
  LessThanOrEqual,
} from 'typeorm';
import { ITransactionUnitOfWork } from '../../domain/ITransactionUnitOfWork';
import { IBudgetUnitOfWork } from '../../../budgets/domain/IBudgetUnitOfWork';
import { IAccountUnitOfWork } from '../../../accounts/domain/IAccountUnitOfWork';
import {
  ITransactionRepository,
  TransactionQueryOptions,
} from '../../domain/repository/transaction.repository';
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
import { FindOptionsWhere } from 'typeorm';

// ── Scoped repositories — private to this file; only the UoW constructs them ──
//
// Each runs on the EntityManager of the ACTIVE QueryRunner, so every read/write
// happens inside the transaction the UoW opened. Key fact about the FOR UPDATE
// locks below: a pessimistic row lock is held until the TRANSACTION commits or
// rolls back — NOT until the findOne call returns. The method returns the row,
// but the lock stays for the whole begin()→commit() window, covering the later
// write. (If these ran on the global DataSource in autocommit, the lock would be
// released right after the SELECT and would be useless — hence scoped repos only.)

class ScopedTransactionRepository extends ITransactionRepository {
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
  async findById(id: string): Promise<Transaction | null> {
    const orm = await this.manager.findOne(TransactionOrmEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    return orm ? this.mapper.toDomain(orm) : null;
  }

  async findByAccountId(
    accountId: string,
    options?: TransactionQueryOptions,
  ): Promise<Transaction[]> {
    const where: FindOptionsWhere<TransactionOrmEntity> = { accountId };
    this.applyDateFilter(where, options);
    const orms = await this.manager.find(TransactionOrmEntity, {
      where,
      skip: options?.offset,
      take: options?.limit,
      order: { transactionDate: 'DESC' },
    });
    return orms.map((orm) => this.mapper.toDomain(orm));
  }

  async findByUserId(
    userId: string,
    options?: TransactionQueryOptions,
  ): Promise<Transaction[]> {
    const where: FindOptionsWhere<TransactionOrmEntity> = { userId };
    this.applyDateFilter(where, options);
    const orms = await this.manager.find(TransactionOrmEntity, {
      where,
      skip: options?.offset,
      take: options?.limit,
      order: { transactionDate: 'DESC' },
    });
    return orms.map((orm) => this.mapper.toDomain(orm));
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
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 1);

    // NO LOCK: aggregate read. Serialization is guaranteed by the pessimistic
    // lock on the budget row taken in findByUserIdAndCategoryIdAndPeriod, which
    // CreateTransactionUseCase acquires BEFORE calling this sum.
    // No one can commit a new expense for THIS budget/period while we hold its row
    // lock, so this aggregate stays consistent through commit — no lock needed here.

    //A FOR UPDATE
    // here would add no correctness (locking existing rows can't block phantom
    // inserts into the range) and would only contend with unrelated reads.
    const raw = await this.manager
      .getRepository(TransactionOrmEntity)
      .createQueryBuilder('transaction')
      .select('COALESCE(SUM(transaction.amount), 0)', 'total')
      .where('transaction.userId = :userId', { userId })
      .andWhere('transaction.categoryId = :categoryId', { categoryId })
      .andWhere('transaction.nature = :nature', { nature: 'expense' })
      .andWhere('transaction.transactionDate >= :periodStart', { periodStart })
      .andWhere('transaction.transactionDate < :periodEnd', { periodEnd })
      .getRawOne<{ total: string }>();

    return Number(raw?.total ?? 0);
  }

  async delete(id: string): Promise<void> {
    await this.manager.delete(TransactionOrmEntity, id);
  }

  private applyDateFilter(
    where: FindOptionsWhere<TransactionOrmEntity>,
    options?: TransactionQueryOptions,
  ): void {
    if (options?.from && options?.to) {
      where.transactionDate = Between(options.from, options.to);
    } else if (options?.from) {
      where.transactionDate = MoreThanOrEqual(options.from);
    } else if (options?.to) {
      where.transactionDate = LessThanOrEqual(options.to);
    }
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
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 1);
    const count = await this.manager
      .getRepository(TransactionOrmEntity)
      .createQueryBuilder('t')
      .where('t.userId = :userId', { userId })
      .andWhere('t.categoryId = :categoryId', { categoryId })
      .andWhere('t.nature = :nature', { nature: 'expense' })
      .andWhere('t.transactionDate >= :periodStart', { periodStart })
      .andWhere('t.transactionDate < :periodEnd', { periodEnd })
      // NO LOCK: Postgres forbids pessimistic locks on aggregates (getCount).
      // Serialization against CreateTransaction is guaranteed by the budget-row
      // lock that DeleteBudgetUseCase takes BEFORE calling this checker. Locking
      // existing rows wouldn't stop phantom inserts anyway.
      .getCount();
    return count > 0;
  }

  async sumExpenseAmountInPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<number> {
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 1);
    const raw = await this.manager
      .getRepository(TransactionOrmEntity)
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.amount), 0)', 'total')
      .where('t.userId = :userId', { userId })
      .andWhere('t.categoryId = :categoryId', { categoryId })
      .andWhere('t.nature = :nature', { nature: 'expense' })
      .andWhere('t.transactionDate >= :periodStart', { periodStart })
      .andWhere('t.transactionDate < :periodEnd', { periodEnd })
      // NO LOCK: Postgres forbids pessimistic locks on aggregates (SUM).
      // Serialization against CreateTransaction is guaranteed by the budget-row
      // lock that UpdateBudgetLimitUseCase takes BEFORE calling this checker.
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
  getTransactionRepository(): ITransactionRepository {
    return new ScopedTransactionRepository(
      this.queryRunner!.manager,
      this.transactionMapper,
    );
  }

  getAccountRepository(): IAccountRepository {
    return new ScopedAccountRepository(
      this.queryRunner!.manager,
      this.accountMapper,
    );
  }

  getBudgetRepository(): IBudgetRepository {
    return new ScopedBudgetRepository(
      this.queryRunner!.manager,
      this.budgetMapper,
    );
  }

  getScopedExpenseChecker(): IExpenseChecker {
    return new ScopedExpenseChecker(this.queryRunner!.manager);
  }
}
