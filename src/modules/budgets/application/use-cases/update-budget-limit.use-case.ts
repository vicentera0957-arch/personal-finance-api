import { Injectable } from '@nestjs/common';
import { IBudgetRepository } from '../../domain/repository/budgets.repository';
import { Budget } from '../../domain/budget.entity';
import { AmountLimit } from '../../domain/amountlimit.vo';
import { GetBudgetByIdUseCase } from './get-budget-by-id.use-case';

interface UpdateBudgetLimitCommand {
  id: string;
  limit: number;
  requestUserId: string;
}

@Injectable()
export class UpdateBudgetLimitUseCase {
  constructor(
    private readonly budgetRepository: IBudgetRepository,
    private readonly getBudgetByIdUseCase: GetBudgetByIdUseCase,
  ) {}

  async execute(command: UpdateBudgetLimitCommand): Promise<Budget> {
    const budget = await this.getBudgetByIdUseCase.execute(
      command.id,
      command.requestUserId,
    );

    const limit = AmountLimit.create(command.limit);
    budget.updateLimit(limit);

    return this.budgetRepository.save(budget);
  }
}
