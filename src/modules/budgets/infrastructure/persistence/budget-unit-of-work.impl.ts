import { Injectable, Scope } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import {
  BudgetTxContext,
  IBudgetUnitOfWork,
} from '../../domain/IBudgetUnitOfWork';
import { IBudgetRepository } from '../../domain/repository/budgets.repository';
import { IExpenseChecker } from '../../domain/ports/expense-checker.port';
import { BudgetMapper } from './budget.mapper';
import { createScopedBudgetRepository } from './scoped-budget.repository';
import { createScopedExpenseChecker } from './scoped-expense-checker';

// ── Implementación del UoW ─────────────────────────────────────────────────────

@Injectable({ scope: Scope.REQUEST })
export class BudgetUnitOfWorkImpl extends IBudgetUnitOfWork {
  private queryRunner: QueryRunner | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mapper: BudgetMapper,
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

  // Both getters read the SAME this.queryRunner field. That is what keeps the
  // FOR UPDATE on the budget row (taken here) and the following aggregate read
  // (no lock, in ScopedExpenseChecker) inside the same transaction — the
  // correctness-critical line of this whole class. If the two getters ever
  // read from different QueryRunners, the aggregate would run outside the
  // budget-row lock and Race 1 / B4 would reopen silently.
  getScopedBudgetRepository(): IBudgetRepository {
    return createScopedBudgetRepository(this.queryRunner!, this.mapper);
  }

  getScopedExpenseChecker(): IExpenseChecker {
    return createScopedExpenseChecker(this.queryRunner!);
  }

  // Transicional: reusa el ciclo de vida manual de arriba. Todavía no usa el
  // AsyncLocalStorage/Proxy de TypeOrmTransactionRunner — ver el comentario
  // equivalente en account-unit-of-work.impl.ts.
  async run<T>(work: (ctx: BudgetTxContext) => Promise<T>): Promise<T> {
    await this.begin();
    try {
      const result = await work({
        budgets: this.getScopedBudgetRepository(),
        expenses: this.getScopedExpenseChecker(),
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
