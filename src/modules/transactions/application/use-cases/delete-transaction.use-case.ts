import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm'; // TODO(tech-debt): abstraer con IUnitOfWork
import { ITransactionRepository } from '../../domain/repository/transaction.repository';
import { GetTransactionByIdUseCase } from './get-transaction-by-id.use-case';
import { CannotDeleteTransactionException } from '../../domain/exceptions/transaction.exceptions';
import { UpdateAccountBalanceUseCase } from '../../../accounts/application/use-cases/update-account-balance.use-case';
import { InsufficientFundsException } from '../../../accounts/domain/exceptions/account.exceptions';

@Injectable()
export class DeleteTransactionUseCase {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly getTransactionByIdUseCase: GetTransactionByIdUseCase,
    private readonly updateAccountBalanceUseCase: UpdateAccountBalanceUseCase,
    private readonly dataSource: DataSource,
  ) {}

  async execute(id: string): Promise<void> {
    // 1. Verifica que la transacción existe
    const transaction = await this.getTransactionByIdUseCase.execute(id);

    // 2. Revierte el efecto en balance de forma atómica
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const reverseType = transaction.nature.isIncome() ? 'outflow' : 'inflow';
      await this.updateAccountBalanceUseCase.execute(
        transaction.accountId,
        transaction.amount.getValue(),
        reverseType,
        qr,
      );
      await this.transactionRepository.delete(id, qr);
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      if (err instanceof InsufficientFundsException) {
        throw new CannotDeleteTransactionException(id);
      }
      throw err;
    } finally {
      await qr.release();
    }
  }
}
