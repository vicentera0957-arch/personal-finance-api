import { Injectable } from '@nestjs/common';
import { IBudgetUnitOfWork } from '../../domain/IBudgetUnitOfWork';
import { IBudgetsCache } from '../../domain/ports/cache/budgets-cache.port';
import {
  BudgetNotFoundException,
  BudgetHasTransactionsInPeriodException,
} from '../../domain/exceptions/budget.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

@Injectable()
export class DeleteBudgetUseCase {
  constructor(
    private readonly uow: IBudgetUnitOfWork,
    private readonly cache: IBudgetsCache,
  ) {}

  async execute(id: string, requestUserId: string): Promise<void> {
    // Open the transaction: grabs a dedicated connection (QueryRunner) for this request.
    await this.uow.begin();
    try {
      const budgetRepo = this.uow.getBudgetRepository();

      // LOCK (FOR UPDATE): budget row. The lock lives inside the scoped repo's findById().
      // It is the serialization gate for the period invariant: holding it blocks concurrent
      // expense creates until this deletion commits (closes Race 1).
      const budget = await budgetRepo.findById(id);
      if (!budget) throw new BudgetNotFoundException(id);
      if (budget.userId !== requestUserId)
        throw new ResourceOwnershipException(id);

      // NO LOCK: aggregate read (Postgres forbids FOR UPDATE on COUNT). Consistent only
      // because the budget row above is locked, which serializes concurrent expense creates.
      const hasExpenses = await this.uow
        .getScopedExpenseChecker()
        .hasExpensesInPeriod(
          budget.userId,
          budget.categoryId,
          budget.month,
          budget.year,
        );

      if (hasExpenses) {
        throw new BudgetHasTransactionsInPeriodException(
          id,
          budget.month,
          budget.year,
        );
      }

      await budgetRepo.delete(id);
      await this.uow.commit();

      await Promise.all([
        this.cache.invalidateUser(budget.userId),
        this.cache.invalidateById(id),
      ]);
    } catch (error) {
      await this.uow.rollback();
      throw error;
    } finally {
      await this.uow.release();
    }
  }
}
