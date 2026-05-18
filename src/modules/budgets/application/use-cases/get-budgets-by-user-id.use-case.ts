import { Injectable } from '@nestjs/common';
import {
  IBudgetRepository,
  BudgetQueryOptions,
} from '../../domain/repository/budgets.repository';
import { IBudgetsCache } from '../../domain/ports/cache/budgets-cache.port';
import { Budget } from '../../domain/budget.entity';

@Injectable()
export class GetBudgetsByUserIdUseCase {
  constructor(
    private readonly budgetRepository: IBudgetRepository,
    private readonly cache: IBudgetsCache,
  ) {}

  async execute(
    userId: string,
    options?: BudgetQueryOptions,
  ): Promise<Budget[]> {
    const cached = await this.cache.getListByUser(userId, options);
    if (cached) return cached;

    const budgets = await this.budgetRepository.findByUserId(userId, options);
    await this.cache.setListByUser(userId, options, budgets);
    return budgets;
  }
}
