import { Transaction } from '../entities/transaction.entity';

//Pagination and filtering options for transaction queries.
export interface TransactionQueryOptions {
  limit?: number;
  offset?: number;
  from?: Date;
  to?: Date;
}

// Puerto de salida como clase abstracta — token de DI para NestJS.
export abstract class ITransactionRepository {
  abstract findById(id: string): Promise<Transaction | null>;
  abstract findByAccountId(
    accountId: string,
    options?: TransactionQueryOptions,
  ): Promise<Transaction[]>;
  abstract findByUserId(
    userId: string,
    options?: TransactionQueryOptions,
  ): Promise<Transaction[]>;
  abstract save(transaction: Transaction): Promise<Transaction>;
  abstract sumExpenseAmountByUserCategoryAndPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<number>;
  abstract delete(id: string): Promise<void>;
}
