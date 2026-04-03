import { Injectable } from '@nestjs/common';
import { IExpenseChecker } from '../../../budgets/domain/repository/expense-checker.port';
import { ITransactionRepository } from '../../domain/repository/transaction.repository';

@Injectable()
export class ExpenseCheckerImpl extends IExpenseChecker {
  constructor(private readonly transactionRepository: ITransactionRepository) {
    super();
  }

  async hasExpensesInPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<boolean> {
    const sum =
      await this.transactionRepository.sumExpenseAmountByUserCategoryAndPeriod(
        userId,
        categoryId,
        month,
        year,
      );
    return sum > 0;
  }
}
