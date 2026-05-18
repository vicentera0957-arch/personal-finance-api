import { Injectable } from '@nestjs/common';
import { IBudgetRepository } from '../../domain/repository/budgets.repository';
import { IBudgetsCache } from '../../domain/ports/cache/budgets-cache.port';
import { Budget } from '../../domain/budget.entity';
import { BudgetNotFoundException } from '../../domain/exceptions/budget.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

@Injectable()
export class GetBudgetByIdUseCase {
  constructor(
    private readonly budgetRepository: IBudgetRepository,
    private readonly cache: IBudgetsCache,
  ) {}

  async execute(id: string, requestUserId: string): Promise<Budget> {
    const cached = await this.cache.getById(id);
    const budget = cached ?? (await this.budgetRepository.findById(id));

    if (!budget) throw new BudgetNotFoundException(id);
    if (budget.userId !== requestUserId)
      throw new ResourceOwnershipException(id);

    if (!cached) await this.cache.setById(budget);
    return budget;
  }
}
