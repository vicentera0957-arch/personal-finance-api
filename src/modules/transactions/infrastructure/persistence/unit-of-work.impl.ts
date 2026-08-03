import { Injectable, Scope } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import {
  ITransactionUnitOfWork,
  TransactionTxContext,
} from '../../domain/ITransactionUnitOfWork';
import { IScopedTransactionRepository } from '../../domain/repository/scoped-transaction.repository';
import { IAccountRepository } from '../../../accounts/domain/repository/accounts.repository';
import { IBudgetRepository } from '../../../budgets/domain/repository/budgets.repository';
import { Transaction } from '../../domain/entities/transaction.entity';
import { TransactionOrmEntity } from './transaction.orm.entity';
import { TransactionMapper } from './transaction.mapper';
import { AccountMapper } from '../../../accounts/infrastructure/persistence/account.mapper';
import { createScopedAccountRepository } from '../../../accounts/infrastructure/persistence/scoped-account.repository';
import { BudgetMapper } from '../../../budgets/infrastructure/persistence/budget.mapper';
import { createScopedBudgetRepository } from '../../../budgets/infrastructure/persistence/scoped-budget.repository';
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

// ── Implementación del UoW ────────────────────────────────────────────────────

/**
 * Concrete implementation of `ITransactionUnitOfWork`.
 *
 * Used to also `implement IBudgetUnitOfWork` and be aliased to both ports via
 * `useExisting`, so `CreateTransaction`/`DeleteTransaction` and
 * `UpdateBudgetLimit`/`DeleteBudget` shared one QueryRunner / one DB
 * transaction whenever they happened to run in the same request (which they
 * never actually needed to — see CLAUDE.md, "Why `IBudgetUnitOfWork` is
 * separate"). Budgets now owns `BudgetUnitOfWorkImpl` for its own boundary;
 * this class serves only `ITransactionUnitOfWork`, for the one flow that
 * genuinely needs a multi-aggregate transaction: `CreateTransaction` writes
 * the transaction, account and budget rows atomically.
 *
 * It still exposes `getScopedBudgetRepository()` — CreateTransaction locks
 * the budget row before summing period expenses — but that getter now goes
 * through `createScopedBudgetRepository()`, the same factory
 * `BudgetUnitOfWorkImpl` uses on its own QueryRunner. Two independent
 * consumers, two independent transactions, same lock semantics.
 */
@Injectable({ scope: Scope.REQUEST })
export class TypeOrmUnitOfWorkImpl extends ITransactionUnitOfWork {
  private queryRunner: QueryRunner | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionMapper: TransactionMapper,
    private readonly accountMapper: AccountMapper,
    private readonly budgetMapper: BudgetMapper,
  ) {
    super();
  }
  // uow methods — begin, commit, rollback, release, isConnected
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
    // No-op si no hay transacción abierta: un commit previo ya la cerró (typeorm
    // pone isTransactionActive=false en commitTransaction()). Sin este guard,
    // rollbackTransaction() lanza TransactionNotStartedError y enmascara la
    // excepción original que llevó al catch del use case.
    if (!this.queryRunner?.isTransactionActive) return;
    await this.queryRunner.rollbackTransaction();
  }

  async release(): Promise<void> {
    await this.queryRunner?.release();
    this.queryRunner = null;
  }

  isConnected(): boolean {
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
    return createScopedAccountRepository(this.queryRunner!, this.accountMapper);
  }

  getScopedBudgetRepository(): IBudgetRepository {
    return createScopedBudgetRepository(this.queryRunner!, this.budgetMapper);
  }

  // Transicional: reusa el ciclo de vida manual de arriba. Todavía no usa el
  // AsyncLocalStorage/Proxy de TypeOrmTransactionRunner — ver el comentario
  // equivalente en account-unit-of-work.impl.ts.
  async run<T>(work: (ctx: TransactionTxContext) => Promise<T>): Promise<T> {
    await this.begin();
    try {
      const result = await work({
        transactions: this.getScopedTransactionRepository(),
        accounts: this.getScopedAccountRepository(),
        budgets: this.getScopedBudgetRepository(),
      });
      await this.commit();
      return result;
    } catch (err) {
      await this.rollback();
      throw err;
    } finally {
      await this.release();
    }
  }
}
