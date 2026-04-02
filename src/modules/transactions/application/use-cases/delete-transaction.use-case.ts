import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ITransactionRepository } from '../../domain/repository/transaction.repository';
import { GetTransactionByIdUseCase } from './get-transaction-by-id.use-case';
import { CannotDeleteTransactionException } from '../../domain/exceptions/transaction.exceptions';
import { GetAccountByIdUseCase } from '../../../accounts/application/use-cases/get-account-by-id.use-case';
import { UpdateAccountBalanceUseCase } from '../../../accounts/application/use-cases/update-account-balance.use-case';
import { InsufficientFundsException } from '../../../accounts/domain/exceptions/account.exceptions';

@Injectable()
export class DeleteTransactionUseCase {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly getTransactionByIdUseCase: GetTransactionByIdUseCase,
    private readonly getAccountByIdUseCase: GetAccountByIdUseCase,
    private readonly updateAccountBalanceUseCase: UpdateAccountBalanceUseCase,
    private readonly dataSource: DataSource,
  ) {}

  async execute(id: string): Promise<void> {
    // 1. Verifica que la transacción existe
    const transaction = await this.getTransactionByIdUseCase.execute(id);

    // 2. Verifica que la cuenta existe (necesaria para revertir el balance)
    await this.getAccountByIdUseCase.execute({
      id: transaction.accountId,
    });

    // 3. Calcula la operación inversa para revertir el balance
    const reverseType = transaction.nature.isIncome() ? 'outflow' : 'inflow';

    // 4. Persiste la cuenta con balance revertido + elimina la transacción de forma atómica.
    //    InsufficientFundsException se mapea a CannotDeleteTransactionException.
    //    Otros errores (ej: CannotOperateOnArchivedAccountException) se propagan tal cual.
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
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
