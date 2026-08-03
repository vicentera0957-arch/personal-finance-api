import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import {
  BudgetTxContext,
  IBudgetUnitOfWork,
} from '../../domain/IBudgetUnitOfWork';
import { BudgetMapper } from './budget.mapper';
import { createScopedBudgetRepository } from './scoped-budget.repository';
import { createScopedExpenseChecker } from './scoped-expense-checker';
import { TypeOrmTransactionRunner } from '../../../../shared/infrastructure/persistence/typeorm-transaction-runner';

// ── Implementación del UoW ─────────────────────────────────────────────────────

@Injectable()
export class BudgetUnitOfWorkImpl
  extends TypeOrmTransactionRunner<BudgetTxContext>
  implements IBudgetUnitOfWork
{
  constructor(
    dataSource: DataSource,
    private readonly mapper: BudgetMapper,
  ) {
    super(dataSource);
  }

  // Both properties are built off the SAME queryRunner argument. That is what
  // keeps the FOR UPDATE on the budget row (ctx.budgets) and the following
  // aggregate read (no lock, ctx.expenses) inside the same transaction — the
  // correctness-critical line of this whole class. If the two ever read from
  // different QueryRunners, the aggregate would run outside the budget-row
  // lock and Race 1 / B4 would reopen silently.
  protected createContext(queryRunner: QueryRunner): BudgetTxContext {
    return {
      budgets: createScopedBudgetRepository(queryRunner, this.mapper),
      expenses: createScopedExpenseChecker(queryRunner),
    };
  }
}
