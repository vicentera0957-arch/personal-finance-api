import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IBudgetRepository } from '../../domain/repository/budgets.repository';
import { Budget } from '../../domain/budget.entity';
import { AmountLimit } from '../../domain/amountlimit.vo';
import {
  BudgetAlreadyExistsException,
  BudgetCategoryMustBeExpenseException,
  CategoryNotBudgetableForBudgetException,
} from '../../domain/exceptions/budget.exceptions';
import { GetCategoryByIdUseCase } from '../../../categories/application/use-cases/get-category-by-id.use-case';

interface CreateBudgetCommand {
  userId: string;
  categoryId: string;
  month: number;
  year: number;
  limit: number;
}

@Injectable()
export class CreateBudgetUseCase {
  constructor(
    private readonly budgetRepository: IBudgetRepository,
    private readonly getCategoryByIdUseCase: GetCategoryByIdUseCase,
  ) {}

  async execute(command: CreateBudgetCommand): Promise<Budget> {
    const category = await this.getCategoryByIdUseCase.execute(
      command.categoryId,
      command.userId,
    );

    if (category.nature.getValue() !== 'expense') {
      throw new BudgetCategoryMustBeExpenseException(
        command.categoryId,
        category.nature.getValue(),
      );
    }

    if (!category.getIsBudgetable()) {
      throw new CategoryNotBudgetableForBudgetException(command.categoryId);
    }

    const existing =
      await this.budgetRepository.findByUserIdAndCategoryIdAndPeriod(
        command.userId,
        command.categoryId,
        command.month,
        command.year,
      );

    if (existing) {
      throw new BudgetAlreadyExistsException(
        command.userId,
        command.categoryId,
        command.month,
        command.year,
      );
    }

    const limit = AmountLimit.create(command.limit);

    const budget = Budget.create({
      id: randomUUID(),
      userId: command.userId,
      categoryId: command.categoryId,
      month: command.month,
      year: command.year,
      limit,
    });

    return this.budgetRepository.save(budget);
  }
}
