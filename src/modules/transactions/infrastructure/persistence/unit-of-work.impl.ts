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

// ── Repos escopados — privados a este archivo, solo el UoW los construye ─────

class ScopedTransactionRepository extends ITransactionRepository {
  constructor(
    private readonly manager: EntityManager,
    private readonly mapper: TransactionMapper,
  ) {
    super();
  }

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

    const raw = await this.manager
      .getRepository(TransactionOrmEntity)
      .createQueryBuilder('transaction')
      .select('COALESCE(SUM(transaction.amount), 0)', 'total')
      .where('transaction.userId = :userId', { userId })
      .andWhere('transaction.categoryId = :categoryId', { categoryId })
      .andWhere('transaction.nature = :nature', { nature: 'expense' })
      .andWhere('transaction.transactionDate >= :periodStart', { periodStart })
      .andWhere('transaction.transactionDate < :periodEnd', { periodEnd })
      .setLock('pessimistic_write')
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
      .setLock('pessimistic_write')
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
      .setLock('pessimistic_write')
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

  async begin(): Promise<void> {
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
