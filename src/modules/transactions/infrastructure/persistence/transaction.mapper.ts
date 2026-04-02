import { Injectable } from '@nestjs/common';
import { Transaction } from '../../domain/entities/transaction.entity';
import { TransactionNature } from '../../domain/value-objects/transaction-nature.vo';
import { Amount } from '../../domain/value-objects/amount.vo';
import { TransactionOrmEntity } from './transaction.orm.entity';

@Injectable()
export class TransactionMapper {
  toDomain(orm: TransactionOrmEntity): Transaction {
    const nature = TransactionNature.reconstitute(orm.nature);
    // reconstitute para Amount: no re-valida, confía en lo que está en la DB
    const amount = Amount.reconstitute(orm.amount);

    return Transaction.reconstitute({
      id: orm.id,
      userId: orm.userId,
      accountId: orm.accountId,
      categoryId: orm.categoryId,
      nature,
      amount,
      description: orm.description ?? undefined,
      transactionDate: orm.transactionDate,
      createdAt: orm.createdAt,
    });
  }

  toOrm(domain: Transaction): TransactionOrmEntity {
    const orm = new TransactionOrmEntity();
    orm.id = domain.id;
    orm.userId = domain.userId;
    orm.accountId = domain.accountId;
    orm.categoryId = domain.categoryId;
    orm.nature = domain.nature.getValue();
    orm.amount = domain.amount.getValue();
    orm.description = domain.description;
    orm.transactionDate = domain.transactionDate;
    orm.createdAt = domain.createdAt;
    return orm;
  }
}
