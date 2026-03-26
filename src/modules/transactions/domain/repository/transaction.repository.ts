import { Transaction } from '../entities/transaction.entity';

// Puerto de salida como clase abstracta — token de DI para NestJS.
export abstract class ITransactionRepository {
  abstract findById(id: string): Promise<Transaction | null>;
  abstract findByAccountId(accountId: string): Promise<Transaction[]>;
  abstract findByUserId(userId: string): Promise<Transaction[]>;
  abstract save(transaction: Transaction): Promise<Transaction>;
  abstract delete(id: string): Promise<void>;
}
