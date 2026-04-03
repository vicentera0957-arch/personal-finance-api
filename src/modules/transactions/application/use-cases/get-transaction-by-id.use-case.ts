import { Injectable } from '@nestjs/common';
import { ITransactionRepository } from '../../domain/repository/transaction.repository';
import { Transaction } from '../../domain/entities/transaction.entity';
import { TransactionNotFoundException } from '../../domain/exceptions/transaction.exceptions';

@Injectable()
export class GetTransactionByIdUseCase {
  constructor(private readonly transactionRepository: ITransactionRepository) {}

  async execute(id: string): Promise<Transaction> {
    const transaction = await this.transactionRepository.findById(id);
    if (!transaction) throw new TransactionNotFoundException(id);
    return transaction;
  }
}
