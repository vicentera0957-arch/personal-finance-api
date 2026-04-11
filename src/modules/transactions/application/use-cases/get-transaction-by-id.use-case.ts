import { Injectable } from '@nestjs/common';
import { ITransactionRepository } from '../../domain/repository/transaction.repository';
import { Transaction } from '../../domain/entities/transaction.entity';
import { TransactionNotFoundException } from '../../domain/exceptions/transaction.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

@Injectable()
export class GetTransactionByIdUseCase {
  constructor(private readonly transactionRepository: ITransactionRepository) {}

  async execute(id: string, requestUserId: string): Promise<Transaction> {
    const transaction = await this.transactionRepository.findById(id);
    if (!transaction) throw new TransactionNotFoundException(id);
    if (transaction.userId !== requestUserId) {
      throw new ResourceOwnershipException(id);
    }
    return transaction;
  }
}
