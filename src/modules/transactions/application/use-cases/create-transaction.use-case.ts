import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { ITransactionRepository } from '../../domain/repository/transaction.repository';
import { Transaction } from '../../domain/entities/transaction.entity';
import { TransactionNature } from '../../domain/value-objects/transaction-nature.vo';
import { Amount } from '../../domain/value-objects/amount.vo';
import { IncompatibleCategoryNatureException } from '../../domain/exceptions/transaction.exceptions';
// Importados desde los módulos vecinos via sus exports
import { GetAccountByIdUseCase } from '../../../accounts/application/use-cases/get-account-by-id.use-case';
import { IAccountRepository } from '../../../accounts/domain/repository/accounts.repository';
import { Balance } from '../../../accounts/domain/value-objects/balance.vo';
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
    private readonly accountRepository: IAccountRepository,
    private readonly getCategoryByIdUseCase: GetCategoryByIdUseCase,
    private readonly dataSource: DataSource,
  ) {}

  async execute(command: CreateTransactionCommand): Promise<Transaction> {
    // 1. Valida naturaleza y monto en el dominio de transactions
    const nature = TransactionNature.create(command.nature);
    const amount = Amount.create(command.amount);

    // 2. Verifica que la cuenta existe (lanza AccountNotFoundException si no)
    const account = await this.getAccountByIdUseCase.execute({
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

    // 6. Aplica el efecto en el balance (dominio puro — sin tocar la DB todavía).
    // outflow puede lanzar InsufficientFundsException antes de abrir la transacción DB.
    const balanceAmount = Balance.create(amount.getValue());
    if (nature.isIncome()) {
      account.inflow(balanceAmount);
    } else {
      account.outflow(balanceAmount);
    }

    // 7. Persiste cuenta + transacción de forma atómica.
    // Si alguno falla, ambos se revierten (ROLLBACK).
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await this.accountRepository.save(account, qr);
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
