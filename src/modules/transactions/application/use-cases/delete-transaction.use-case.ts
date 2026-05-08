import { Injectable } from '@nestjs/common';
import { ITransactionUnitOfWork } from '../../domain/ITransactionUnitOfWork';
import { GetTransactionByIdUseCase } from './get-transaction-by-id.use-case';
import {
  CannotDeleteTransactionException,
  TransactionNotFoundException,
} from '../../domain/exceptions/transaction.exceptions';
import { UpdateAccountBalanceUseCase } from '../../../accounts/application/use-cases/update-account-balance.use-case';
import { InsufficientFundsException } from '../../../accounts/domain/exceptions/account.exceptions';

@Injectable()
export class DeleteTransactionUseCase {
  constructor(
    private readonly uow: ITransactionUnitOfWork,
    private readonly getTransactionByIdUseCase: GetTransactionByIdUseCase,
  ) {}

  async execute(id: string, requestUserId: string): Promise<void> {
    await this.getTransactionByIdUseCase.execute(id, requestUserId); // Fail-fast: 404/403 sin abrir conexión al pool

    await this.uow.begin(); // empieza tx
    try {
      const txRepo = this.uow.getTransactionRepository();
      const acctRepo = this.uow.getAccountRepository();

      // Re-fetch con FOR UPDATE — serializa DELETEs concurrentes sobre la misma fila;
      // si otra request ya borró T y commiteó, findById retorna null aquí.
      const transaction = await txRepo.findById(id);
      if (!transaction) throw new TransactionNotFoundException(id);

      const updateBalance = new UpdateAccountBalanceUseCase(acctRepo);
      const reverseType = transaction.nature.isIncome() ? 'outflow' : 'inflow';
      await updateBalance.execute(
        transaction.accountId,
        transaction.amount.getValue(),
        reverseType,
      );
      await txRepo.delete(id);
      await this.uow.commit();
    } catch (err) {
      await this.uow.rollback();
      if (err instanceof InsufficientFundsException) {
        throw new CannotDeleteTransactionException(id);
      }
      throw err;
    } finally {
      await this.uow.release();
    }
  }
}
