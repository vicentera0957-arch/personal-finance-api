import { Injectable } from '@nestjs/common';
import {
  ITransactionRepository,
  TransactionQueryOptions,
} from '../../domain/repository/transaction.repository';
import { Transaction } from '../../domain/entities/transaction.entity';
import { GetAccountByIdUseCase } from '../../../accounts/application/use-cases/get-account-by-id.use-case';

@Injectable()
export class GetTransactionsByAccountIdUseCase {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly getAccountByIdUseCase: GetAccountByIdUseCase,
  ) {}

  async execute(
    accountId: string,
    requestUserId: string,
    options?: TransactionQueryOptions,
  ): Promise<Transaction[]> {
    // Verifica que el usuario tiene acceso a esta cuenta
    await this.getAccountByIdUseCase.execute({
      id: accountId,
      requestUserId,
    });
    return this.transactionRepository.findByAccountId(accountId, options);
  }
}
