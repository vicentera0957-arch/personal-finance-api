import { Injectable } from '@nestjs/common';
import {
  ITransactionRepository,
  TransactionQueryOptions,
} from '../../domain/repository/transaction.repository';
import { Transaction } from '../../domain/entities/transaction.entity';

@Injectable()
export class GetTransactionsByAccountIdUseCase {
  constructor(private readonly transactionRepository: ITransactionRepository) {}

  async execute(
    accountId: string,
    options?: TransactionQueryOptions,
  ): Promise<Transaction[]> {
    return this.transactionRepository.findByAccountId(accountId, options);
  }
}
