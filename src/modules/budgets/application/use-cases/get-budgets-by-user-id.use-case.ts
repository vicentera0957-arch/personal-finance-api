import { Injectable } from '@nestjs/common';
import {
  BudgetQueryOptions,
  IBudgetRepository,
} from '../../domain/repository/budgets.repository';
import { Budget } from '../../domain/budget.entity';

@Injectable()
export class GetBudgetsByUserIdUseCase {
  constructor(private readonly budgetRepository: IBudgetRepository) {}

  async execute(
    userId: string,
    options?: BudgetQueryOptions,
  ): Promise<Budget[]> {
    return this.budgetRepository.findByUserId(userId, options);
  }
}
