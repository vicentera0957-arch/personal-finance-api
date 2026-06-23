import {
  ITransactionRepository,
  TransactionQueryOptions,
} from '../../../domain/repository/transaction.repository';
import { IScopedTransactionRepository } from '../../../domain/repository/scoped-transaction.repository';
import { Transaction } from '../../../domain/entities/transaction.entity';

// Test double playing both roles: the query port (global repo) and the command port
// (scoped repo handed out by the UoW fake). In-memory has no real locks, so
// findByIdWithLock is the same lookup as findById.
export class InMemoryTransactionRepository
  extends ITransactionRepository
  implements IScopedTransactionRepository
{
  private readonly store = new Map<string, Transaction>();

  async findById(id: string): Promise<Transaction | null> {
    return this.store.get(id) ?? null;
  }

  async findByIdWithLock(id: string): Promise<Transaction | null> {
    return this.store.get(id) ?? null;
  }

  async findByAccountId(
    accountId: string,
    options?: TransactionQueryOptions,
  ): Promise<Transaction[]> {
    return this.applyQuery(
      Array.from(this.store.values()).filter((t) => t.accountId === accountId),
      options,
    );
  }

  async findByUserId(
    userId: string,
    options?: TransactionQueryOptions,
  ): Promise<Transaction[]> {
    return this.applyQuery(
      Array.from(this.store.values()).filter((t) => t.userId === userId),
      options,
    );
  }

  async save(transaction: Transaction): Promise<Transaction> {
    this.store.set(transaction.id, transaction);
    return transaction;
  }

  async sumExpenseAmountByUserCategoryAndPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<number> {
    let sum = 0;
    for (const t of this.store.values()) {
      if (
        t.userId === userId &&
        t.categoryId === categoryId &&
        t.nature.isExpense() &&
        t.transactionDate.getMonth() + 1 === month &&
        t.transactionDate.getFullYear() === year
      ) {
        sum += t.amount.getValue();
      }
    }
    return sum;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  seed(transactions: Transaction[]): void {
    for (const t of transactions) this.store.set(t.id, t);
  }

  size(): number {
    return this.store.size;
  }

  private applyQuery(
    items: Transaction[],
    options?: TransactionQueryOptions,
  ): Transaction[] {
    let result = items;
    if (options?.from) {
      const from = options.from;
      result = result.filter((t) => t.transactionDate >= from);
    }
    if (options?.to) {
      const to = options.to;
      result = result.filter((t) => t.transactionDate <= to);
    }
    result = result.sort(
      (a, b) => b.transactionDate.getTime() - a.transactionDate.getTime(),
    );
    if (options?.offset) result = result.slice(options.offset);
    if (options?.limit !== undefined) result = result.slice(0, options.limit);
    return result;
  }
}
