import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ITransactionRepository } from '../../domain/repository/transaction.repository';
import { GetTransactionByIdUseCase } from './get-transaction-by-id.use-case';
import { CannotDeleteTransactionException } from '../../domain/exceptions/transaction.exceptions';
import { GetAccountByIdUseCase } from '../../../accounts/application/use-cases/get-account-by-id.use-case';
import { IAccountRepository } from '../../../accounts/domain/repository/accounts.repository';
import { Balance } from '../../../accounts/domain/value-objects/balance.vo';
import { InsufficientFundsException } from '../../../accounts/domain/exceptions/account.exceptions';

@Injectable()
export class DeleteTransactionUseCase {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly getTransactionByIdUseCase: GetTransactionByIdUseCase,
    private readonly getAccountByIdUseCase: GetAccountByIdUseCase,
    private readonly accountRepository: IAccountRepository,
    private readonly dataSource: DataSource,
  ) {}

  async execute(id: string): Promise<void> {
    // 1. Verifica que la transacción existe
    const transaction = await this.getTransactionByIdUseCase.execute(id);

    // 2. Recupera la cuenta para revertir el efecto en el balance
    const account = await this.getAccountByIdUseCase.execute({
      id: transaction.accountId,
    });

    const balanceAmount = Balance.create(transaction.amount.getValue());

    // 3. Revierte el efecto según la naturaleza (dominio puro — sin tocar la DB todavía).
    //    Solo InsufficientFundsException se convierte en CannotDeleteTransactionException.
    //    Otros errores (ej: CannotOperateOnArchivedAccountException) se propagan tal cual.
    try {
      if (transaction.nature.isIncome()) {
        account.outflow(balanceAmount);
      } else {
        account.inflow(balanceAmount);
      }
    } catch (err) {
      if (err instanceof InsufficientFundsException) {
        throw new CannotDeleteTransactionException(id);
      }
      throw err;
    }

    // 4. Persiste la cuenta con balance revertido + elimina la transacción de forma atómica.
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await this.accountRepository.save(account, qr);
      await this.transactionRepository.delete(id, qr);
      await qr.commitTransaction();
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }
}
