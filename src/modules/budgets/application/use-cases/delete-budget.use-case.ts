import { Injectable } from '@nestjs/common';
import { IBudgetUnitOfWork } from '../../domain/IBudgetUnitOfWork';
import {
  BudgetNotFoundException,
  BudgetHasTransactionsInPeriodException,
} from '../../domain/exceptions/budget.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

@Injectable()
export class DeleteBudgetUseCase {
  constructor(private readonly uow: IBudgetUnitOfWork) {}

  async execute(id: string, requestUserId: string): Promise<void> {
    await this.uow.begin();
    try {
      const budgetRepo = this.uow.getBudgetRepository();

      const budget = await budgetRepo.findById(id);
      if (!budget) throw new BudgetNotFoundException(id);
      if (budget.userId !== requestUserId) throw new ResourceOwnershipException(id);

      const hasExpenses = await this.uow
        .getScopedExpenseChecker()
        .hasExpensesInPeriod(budget.userId, budget.categoryId, budget.month, budget.year);

      if (hasExpenses) {
        throw new BudgetHasTransactionsInPeriodException(id, budget.month, budget.year);
      }

      await budgetRepo.delete(id);
      await this.uow.commit();
    } catch (error) {
      await this.uow.rollback();
      throw error;
    } finally {
      await this.uow.release();
    }
  }
}
