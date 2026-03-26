import { Injectable } from '@nestjs/common';
import { ITransactionRepository } from '../../domain/repository/transaction.repository';
import { Transaction } from '../../domain/entities/transaction.entity';

@Injectable()
export class GetTransactionsByAccountIdUseCase {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
  ) {}

  async execute(accountId: string): Promise<Transaction[]> {
    return this.transactionRepository.findByAccountId(accountId);
  }
}
