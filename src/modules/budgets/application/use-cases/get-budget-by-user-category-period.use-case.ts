import { Injectable } from '@nestjs/common';
import { IBudgetRepository } from '../../domain/repository/budgets.repository';
import { Budget } from '../../domain/budget.entity';

interface GetBudgetByUserCategoryPeriodCommand {
  userId: string;
  categoryId: string;
  month: number;
  year: number;
}

@Injectable()
export class GetBudgetByUserCategoryPeriodUseCase {
  constructor(private readonly budgetRepository: IBudgetRepository) {}

  async execute(
    command: GetBudgetByUserCategoryPeriodCommand,
  ): Promise<Budget | null> {
    return this.budgetRepository.findByUserIdAndCategoryIdAndPeriod(
      command.userId,
      command.categoryId,
      command.month,
      command.year,
    );
  }
}
