import { Injectable } from '@nestjs/common';
import { IBudgetRepository } from '../../domain/repository/budgets.repository';
import { IExpenseChecker } from '../../domain/repository/expense-checker.port';
import { BudgetHasTransactionsInPeriodException } from '../../domain/exceptions/budget.exceptions';
import { GetBudgetByIdUseCase } from './get-budget-by-id.use-case';

@Injectable()
export class DeleteBudgetUseCase {
  constructor(
    private readonly budgetRepository: IBudgetRepository,
    private readonly getBudgetByIdUseCase: GetBudgetByIdUseCase,
    private readonly expenseChecker: IExpenseChecker,
  ) {}

  async execute(id: string): Promise<void> {
    const budget = await this.getBudgetByIdUseCase.execute(id);

    // Valida que no existan transacciones de gasto en el periodo del presupuesto
    const hasExpenses = await this.expenseChecker.hasExpensesInPeriod(
      budget.userId,
      budget.categoryId,
      budget.month,
      budget.year,
    );

    if (hasExpenses) {
      throw new BudgetHasTransactionsInPeriodException(
        id,
        budget.month,
        budget.year,
      );
    }

    await this.budgetRepository.delete(id);
  }
}
