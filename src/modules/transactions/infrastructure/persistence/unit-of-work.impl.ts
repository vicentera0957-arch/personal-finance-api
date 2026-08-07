import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import {
  ITransactionUnitOfWork,
  TransactionTxContext,
} from '../../domain/ITransactionUnitOfWork';
import { IScopedTransactionRepository } from '../../domain/repository/scoped-transaction.repository';
import { Transaction } from '../../domain/entities/transaction.entity';
import { TransactionOrmEntity } from './transaction.orm.entity';
import { TransactionMapper } from './transaction.mapper';
import { AccountMapper } from '../../../accounts/infrastructure/persistence/account.mapper';
import { createScopedAccountRepository } from '../../../accounts/infrastructure/persistence/scoped-account.repository';
import { BudgetMapper } from '../../../budgets/infrastructure/persistence/budget.mapper';
import { createScopedBudgetPeriodReader } from '../../../budgets/infrastructure/persistence/scoped-budget.repository';
import { sumPeriodExpenses } from '../../../../shared/infrastructure/persistence/period-expenses.query';
import { TypeOrmTransactionRunner } from '../../../../shared/infrastructure/persistence/typeorm-transaction-runner';

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
    // NO LOCK: aggregate read. Serialization is guaranteed by the pessimistic
    // lock on the budget row taken in findByUserIdAndCategoryIdAndPeriod, which
    // CreateTransactionUseCase acquires BEFORE calling this sum.
    // No one can commit a new expense for THIS budget/period while we hold its row
    // lock, so this aggregate stays consistent through commit — no lock needed here.
    // A FOR UPDATE here would add no correctness (locking existing rows can't block
    // phantom inserts into the range) and would only contend with unrelated reads.
    //
    // Query lives in shared/infrastructure/persistence/period-expenses.query.ts —
    // the single owner of "Σ gastos del período" (PROBLEMS.md P6), same one
    // ScopedExpenseChecker.sumExpenseAmountInPeriod (budgets) calls. Runs on the
    // SAME this.manager (same QueryRunner → same transaction), so the budget-row
    // lock the caller holds still serializes it.
    return sumPeriodExpenses(this.manager, userId, categoryId, month, year);
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
 * The lifecycle (QueryRunner creation, begin/commit/rollback/release, the
 * anti-leak Proxy, nested-`run()` detection) lives entirely in
 * `TypeOrmTransactionRunner` — this class contributes only `createContext()`,
 * which builds the three scoped resources on the active QueryRunner. Since
 * there is no `QueryRunner` field anymore, this provider is a plain
 * singleton, no request scoping: the `QueryRunner` lives on the call stack
 * of `run()`.
 *
 * `ctx.budgetPeriodReader` — CreateTransaction locks the budget row before
 * summing period expenses — goes through `createScopedBudgetPeriodReader()`,
 * built off the SAME underlying class `createScopedBudgetRepository()` hands
 * to `BudgetUnitOfWorkImpl`, just narrowed to a read-only view (P5): this
 * flow only ever reads the limit, never writes the budget. Two independent
 * consumers, two independent transactions, same lock semantics, zero
 * duplicated SQL.
 */
@Injectable()
export class TypeOrmUnitOfWorkImpl
  extends TypeOrmTransactionRunner<TransactionTxContext>
  implements ITransactionUnitOfWork
{
  constructor(
    dataSource: DataSource,
    private readonly transactionMapper: TransactionMapper,
    private readonly accountMapper: AccountMapper,
    private readonly budgetMapper: BudgetMapper,
  ) {
    super(dataSource);
  }

  protected createContext(queryRunner: QueryRunner): TransactionTxContext {
    return {
      transactions: new ScopedTransactionRepository(
        queryRunner.manager,
        this.transactionMapper,
      ),
      accounts: createScopedAccountRepository(queryRunner, this.accountMapper),
      budgetPeriodReader: createScopedBudgetPeriodReader(
        queryRunner,
        this.budgetMapper,
      ),
    };
  }
}
