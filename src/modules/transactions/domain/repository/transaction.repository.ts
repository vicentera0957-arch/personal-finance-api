import { Transaction } from '../entities/transaction.entity';

//Pagination and filtering options for transaction queries.
export interface TransactionQueryOptions {
  limit?: number;
  offset?: number;
  from?: Date;
  to?: Date;
}

// Query-side port (DI token for NestJS). Read-only, no locks — runs on the global
// connection in autocommit. Mutations and locking reads live on IScopedTransactionRepository,
// reachable only through the Unit of Work. Splitting the two makes it impossible (by types)
// to write a transaction outside an open DB transaction.
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
}
