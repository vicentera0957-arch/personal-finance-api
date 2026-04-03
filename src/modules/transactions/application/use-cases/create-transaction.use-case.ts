import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm'; // TODO(tech-debt): abstraer con IUnitOfWork
import { ITransactionRepository } from '../../domain/repository/transaction.repository';
import { Transaction } from '../../domain/entities/transaction.entity';
import { TransactionNature } from '../../domain/value-objects/transaction-nature.vo';
import { Amount } from '../../domain/value-objects/amount.vo';
import { IncompatibleCategoryNatureException } from '../../domain/exceptions/transaction.exceptions';
import { GetBudgetByUserCategoryPeriodUseCase } from '../../../budgets/application/use-cases/get-budget-by-user-category-period.use-case';
import {
  BudgetLimitExceededException,
  BudgetRequiredForExpenseTransactionException,
  CategoryNotBudgetableForBudgetException,
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
    private readonly transactionRepository: ITransactionRepository,
    private readonly getAccountByIdUseCase: GetAccountByIdUseCase,
    private readonly updateAccountBalanceUseCase: UpdateAccountBalanceUseCase,
    private readonly getCategoryByIdUseCase: GetCategoryByIdUseCase,
    private readonly getBudgetByUserCategoryPeriodUseCase: GetBudgetByUserCategoryPeriodUseCase,
    private readonly dataSource: DataSource,
  ) {}

  async execute(command: CreateTransactionCommand): Promise<Transaction> {
    // 1. Valida naturaleza y monto en el dominio de transactions
    const nature = TransactionNature.create(command.nature);
    const amount = Amount.create(command.amount);

    // 2. Verifica que la cuenta existe (lanza AccountNotFoundException si no)
    await this.getAccountByIdUseCase.execute({
      id: command.accountId,
    });

    // 3. Verifica que la categoría existe (lanza CategoryNotFoundException si no)
    const category = await this.getCategoryByIdUseCase.execute(
      command.categoryId,
    );

    // 4. Valida compatibilidad de naturaleza (R7)
    if (category.nature.getValue() !== nature.getValue()) {
      throw new IncompatibleCategoryNatureException(
        nature.getValue(),
        category.nature.getValue(),
      );
    }

    // Validaciones previas al budget (no requieren lock)
    if (nature.isExpense()) {
      if (!category.getIsBudgetable()) {
        throw new CategoryNotBudgetableForBudgetException(command.categoryId);
      }

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

    // 5. Crea la entidad de transacción
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

    // 6. Persiste transacción + actualiza balance atómicamente (lock pesimista)
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      // Validación de budget dentro de la transacción con lock pesimista
      if (nature.isExpense()) {
        const month = command.transactionDate.getMonth() + 1;
        const year = command.transactionDate.getFullYear();

        const spentInPeriod =
          await this.transactionRepository.sumExpenseAmountByUserCategoryAndPeriod(
            command.userId,
            command.categoryId,
            month,
            year,
            qr,
          );

        const budget = await this.getBudgetByUserCategoryPeriodUseCase.execute({
          userId: command.userId,
          categoryId: command.categoryId,
          month,
          year,
        });

        const projectedSpent = spentInPeriod + amount.getValue();
        const limit = budget!.getLimit().getValue();

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

      await this.updateAccountBalanceUseCase.execute(
        command.accountId,
        amount.getValue(),
        nature.isIncome() ? 'inflow' : 'outflow',
        qr,
      );
      const saved = await this.transactionRepository.save(transaction, qr);
      await qr.commitTransaction();
      return saved;
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }
}
