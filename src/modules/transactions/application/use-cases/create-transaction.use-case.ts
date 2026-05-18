import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ITransactionUnitOfWork } from '../../domain/ITransactionUnitOfWork';
import { Transaction } from '../../domain/entities/transaction.entity';
import { TransactionNature } from '../../domain/value-objects/transaction-nature.vo';
import { Amount } from '../../domain/value-objects/amount.vo';
import { IncompatibleCategoryNatureException } from '../../domain/exceptions/transaction.exceptions';
import { GetBudgetByUserCategoryPeriodUseCase } from '../../../budgets/application/use-cases/get-budget-by-user-category-period.use-case';
import {
  BudgetLimitExceededException,
  BudgetRequiredForExpenseTransactionException,
} from '../../../budgets/domain/exceptions/budget.exceptions';
import { GetAccountByIdUseCase } from '../../../accounts/application/use-cases/get-account-by-id.use-case';
import { UpdateAccountBalanceUseCase } from '../../../accounts/application/use-cases/update-account-balance.use-case';
import { GetCategoryByIdUseCase } from '../../../categories/application/use-cases/get-category-by-id.use-case';

interface CreateTransactionCommand {
  userId: string;
  accountId: string;
  categoryId: string;
  nature: string;
  amount: number;
  description?: string;
  transactionDate: Date;
}

@Injectable()
export class CreateTransactionUseCase {
  constructor(
    private readonly uow: ITransactionUnitOfWork,
    private readonly getAccountByIdUseCase: GetAccountByIdUseCase,
    private readonly getCategoryByIdUseCase: GetCategoryByIdUseCase,
    private readonly getBudgetByUserCategoryPeriodUseCase: GetBudgetByUserCategoryPeriodUseCase,
  ) {}

  async execute(command: CreateTransactionCommand): Promise<Transaction> {
    const nature = TransactionNature.create(command.nature);
    const amount = Amount.create(command.amount);

    await this.getAccountByIdUseCase.execute({
      id: command.accountId,
      requestUserId: command.userId,
    });

    const category = await this.getCategoryByIdUseCase.execute(
      command.categoryId,
      command.userId,
    );

    if (category.nature.getValue() !== nature.getValue()) {
      throw new IncompatibleCategoryNatureException(
        nature.getValue(),
        category.nature.getValue(),
      );
    }

    if (nature.isExpense()) {
      const month = command.transactionDate.getMonth() + 1;
      const year = command.transactionDate.getFullYear();

      const budget = await this.getBudgetByUserCategoryPeriodUseCase.execute({
        userId: command.userId,
        categoryId: command.categoryId,
        month,
        year,
      });

      if (!budget) {
        throw new BudgetRequiredForExpenseTransactionException(
          command.categoryId,
          month,
          year,
        );
      }
    }

    const transaction = Transaction.create({
      id: randomUUID(),
      userId: command.userId,
      accountId: command.accountId,
      categoryId: command.categoryId,
      nature,
      amount,
      description: command.description,
      transactionDate: command.transactionDate,
    });

    await this.uow.begin();
    try {
      const txRepo = this.uow.getTransactionRepository();
      const acctRepo = this.uow.getAccountRepository();
      const updateBalance = new UpdateAccountBalanceUseCase(acctRepo);

      if (nature.isExpense()) {
        const budgetRepo = this.uow.getBudgetRepository();
        const month = command.transactionDate.getMonth() + 1;
        const year = command.transactionDate.getFullYear();

        // El budget row es el gate de serialización del invariante de período.
        // Debe lockearse ANTES del SUM: un FOR UPDATE sobre un rango de
        // transactions no previene phantoms (inserts concurrentes en el rango),
        // así que la sumatoria solo es consistente si se lee bajo el lock del budget.
        const budget = await budgetRepo.findByUserIdAndCategoryIdAndPeriod(
          command.userId,
          command.categoryId,
          month,
          year,
        );

        if (!budget) {
          throw new BudgetRequiredForExpenseTransactionException(
            command.categoryId,
            month,
            year,
          );
        }

        const spentInPeriod =
          await txRepo.sumExpenseAmountByUserCategoryAndPeriod(
            command.userId,
            command.categoryId,
            month,
            year,
          );

        const projectedSpent = spentInPeriod + amount.getValue();
        const limit = budget.getLimit().getValue();

        if (projectedSpent > limit) {
          throw new BudgetLimitExceededException(
            command.categoryId,
            month,
            year,
            limit,
            projectedSpent,
          );
        }
      }

      await updateBalance.execute(
        command.accountId,
        amount.getValue(),
        nature.isIncome() ? 'inflow' : 'outflow',
      );
      const saved = await txRepo.save(transaction);
      await this.uow.commit();
      return saved;
    } catch (err) {
      await this.uow.rollback();
      throw err;
    } finally {
      await this.uow.release();
    }
  }
}
