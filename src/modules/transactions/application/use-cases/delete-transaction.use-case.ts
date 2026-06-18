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
    // Fail-fast outside the tx: cheap 404/403 without grabbing a pool connection.
    await this.getTransactionByIdUseCase.execute(id, requestUserId);

    // Open the transaction: grabs a dedicated connection (QueryRunner) for this request.
    await this.uow.begin();
    try {
      // Scoped repos share the same QueryRunner → same transaction and connection.
      const txRepo = this.uow.getScopedTransactionRepository();
      const acctRepo = this.uow.getScopedAccountRepository();

      // LOCK (FOR UPDATE): transaction row. The lock lives inside the scoped repo's
      // findById(). Serializes concurrent DELETEs on the same row: if another request
      // already deleted and committed, findById returns null here (→ 404, no double reverse).
      const transaction = await txRepo.findById(id);
      if (!transaction) throw new TransactionNotFoundException(id);

      const updateBalance = new UpdateAccountBalanceUseCase(acctRepo);
      const reverseType = transaction.nature.isIncome() ? 'outflow' : 'inflow';
      // LOCK (FOR UPDATE): account row. The lock is taken inside UpdateAccountBalanceUseCase
      // via the scoped acctRepo.findById() — serializes balance mutations on this account.
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
