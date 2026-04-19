import { Injectable } from '@nestjs/common';
import { IUnitOfWork } from '../../domain/IUnitOfWork';
import { GetTransactionByIdUseCase } from './get-transaction-by-id.use-case';
import { CannotDeleteTransactionException } from '../../domain/exceptions/transaction.exceptions';
import { UpdateAccountBalanceUseCase } from '../../../accounts/application/use-cases/update-account-balance.use-case';
import { InsufficientFundsException } from '../../../accounts/domain/exceptions/account.exceptions';

@Injectable()
export class DeleteTransactionUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly getTransactionByIdUseCase: GetTransactionByIdUseCase,
  ) {}

  async execute(id: string, requestUserId: string): Promise<void> {
    const transaction = await this.getTransactionByIdUseCase.execute(
      id,
      requestUserId,
    );

    await this.uow.begin();
    try {
      const txRepo = this.uow.getTransactionRepository();
      const acctRepo = this.uow.getAccountRepository();
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
