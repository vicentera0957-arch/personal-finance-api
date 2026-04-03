import { Injectable } from '@nestjs/common';
import { IBudgetRepository } from '../../domain/repository/budgets.repository';
import { Budget } from '../../domain/budget.entity';
import { BudgetNotFoundException } from '../../domain/exceptions/budget.exceptions';

@Injectable()
export class GetBudgetByIdUseCase {
  constructor(private readonly budgetRepository: IBudgetRepository) {}

  async execute(id: string): Promise<Budget> {
    const budget = await this.budgetRepository.findById(id);
    if (!budget) {
      throw new BudgetNotFoundException(id);
    }
    return budget;
  }
}
