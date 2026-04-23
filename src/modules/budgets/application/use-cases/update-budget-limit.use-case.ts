import { Injectable } from '@nestjs/common';
import { IUnitOfWork } from '../../../transactions/domain/IUnitOfWork';
import { Budget } from '../../domain/budget.entity';
import { AmountLimit } from '../../domain/amountlimit.vo';
import {
  BudgetNotFoundException,
  BudgetAccessDeniedException,
} from '../../domain/exceptions/budget.exceptions';
import { GetCategoryByIdUseCase } from '../../../categories/application/use-cases/get-category-by-id.use-case';

interface UpdateBudgetLimitCommand {
  id: string;
  limit: number;
  requestUserId: string;
}

@Injectable()
export class UpdateBudgetLimitUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly getCategoryByIdUseCase: GetCategoryByIdUseCase,
  ) {}

  async execute(command: UpdateBudgetLimitCommand): Promise<Budget> {
    await this.uow.begin();
    try {
      const budgetRepo = this.uow.getBudgetRepository();

      const budget = await budgetRepo.findById(command.id);
      if (!budget) {
        throw new BudgetNotFoundException(command.id);
      }

      if (budget.userId !== command.requestUserId) {
        throw new BudgetAccessDeniedException(command.id);
      }

      const limit = AmountLimit.create(command.limit);
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
