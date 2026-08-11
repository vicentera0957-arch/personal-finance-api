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

    try {
      // Todo lo transaccional adentro. El commit lo hace el runner al salir sin excepción.
      await this.uow.run(async (ctx) => {
        // LOCK (FOR UPDATE): transaction row. The lock lives inside the scoped repo's
        // findByIdWithLock(). Serializes concurrent DELETEs on the same row: if another request
        // already deleted and committed, it returns null here (→ 404, no double reverse).
        const transaction = await ctx.transactions.findByIdWithLock(id);
        if (!transaction) throw new TransactionNotFoundException(id);

        const updateBalance = new UpdateAccountBalanceUseCase(ctx.accounts);
        const reverseType = transaction.nature.isIncome()
          ? 'outflow'
          : 'inflow';
        // LOCK (FOR UPDATE): account row. The lock is taken inside UpdateAccountBalanceUseCase
        // via the scoped acctRepo.findById() — serializes balance mutations on this account.
        await updateBalance.execute(
          transaction.accountId,
          transaction.amount.getValue(),
          reverseType,
        );
        await ctx.transactions.delete(id);
      });
    } catch (err) {
      // La traducción sale del alcance transaccional: el rollback ya ocurrió
      // dentro de run() antes de re-lanzar. Es una decisión del use case, no
      // del ciclo de vida (ver docs/history/structural-refactors.md, P3+P4 (§2.4.a del plan archivado)).
      if (err instanceof InsufficientFundsException) {
        throw new CannotDeleteTransactionException(id);
      }
      throw err;
    }
  }
}
