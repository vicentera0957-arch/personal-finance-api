import { Injectable } from '@nestjs/common';
import { IBudgetUnitOfWork } from '../../domain/IBudgetUnitOfWork';
import { Budget } from '../../domain/budget.entity';
import { AmountLimit } from '../../domain/amountlimit.vo';
import {
  BudgetNotFoundException,
  BudgetLimitBelowSpentException,
} from '../../domain/exceptions/budget.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

interface UpdateBudgetLimitCommand {
  id: string;
  limit: number;
  requestUserId: string;
}

@Injectable()
export class UpdateBudgetLimitUseCase {
  constructor(private readonly uow: IBudgetUnitOfWork) {}

  async execute(command: UpdateBudgetLimitCommand): Promise<Budget> {
    await this.uow.begin();
    try {
      const budgetRepo = this.uow.getBudgetRepository();

      const budget = await budgetRepo.findById(command.id);
      if (!budget) {
        throw new BudgetNotFoundException(command.id);
      }

      if (budget.userId !== command.requestUserId) {
        throw new ResourceOwnershipException(command.id);
      }

      const limit = AmountLimit.create(command.limit);
      const spentInPeriod = await this.uow
        .getScopedExpenseChecker()
        .sumExpenseAmountInPeriod(
          budget.userId,
          budget.categoryId,
          budget.month,
          budget.year,
        );

      if (limit.getValue() < spentInPeriod) {
        throw new BudgetLimitBelowSpentException(
          budget.id,
          budget.month,
          budget.year,
          limit.getValue(),
          spentInPeriod,
        );
      }
      budget.updateLimit(limit);

      const updated = await budgetRepo.save(budget);
      await this.uow.commit();

      return updated;
    } catch (error) {
      await this.uow.rollback();
      throw error;
    } finally {
      await this.uow.release();
    }
  }
}
