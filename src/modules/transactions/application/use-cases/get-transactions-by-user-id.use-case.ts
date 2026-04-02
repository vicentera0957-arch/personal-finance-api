import { Injectable } from '@nestjs/common';
import {
  ITransactionRepository,
  TransactionQueryOptions,
} from '../../domain/repository/transaction.repository';
import { Transaction } from '../../domain/entities/transaction.entity';

@Injectable()
export class GetTransactionsByUserIdUseCase {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
  ) {}

  async execute(
    userId: string,
    options?: TransactionQueryOptions,
  ): Promise<Transaction[]> {
    return this.transactionRepository.findByUserId(userId, options);
  }
}
