import { Transaction } from '../entities/transaction.entity';

// Command-side port: the transaction surface that may only run INSIDE an open Unit of Work
// (on the QueryRunner's EntityManager). It is never a DI token — the UoW constructs the scoped
// implementation and hands it out via getScopedTransactionRepository().
//
// `findByIdWithLock` takes a pessimistic `FOR UPDATE` lock; the name is explicit on purpose so
// the lock is visible at every call site (mirrors auth's `findByTokenHashWithLock`).
export abstract class IScopedTransactionRepository {
  abstract findByIdWithLock(id: string): Promise<Transaction | null>;
  abstract sumExpenseAmountByUserCategoryAndPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<number>;
  abstract save(transaction: Transaction): Promise<Transaction>;
  abstract delete(id: string): Promise<void>;
}
