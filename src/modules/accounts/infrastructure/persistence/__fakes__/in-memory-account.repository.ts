import { IAccountRepository } from '../../../domain/repository/accounts.repository';
import { IScopedAccountRepository } from '../../../domain/repository/scoped-account.repository';
import { Account } from '../../../domain/entities/account.entity';

// Test double playing both roles: the query port (global repo) and the
// command port (scoped repo handed out by the UoW fake). In-memory has no
// real locks, so findByIdWithLock is the same lookup as findById.
export class InMemoryAccountRepository
  extends IAccountRepository
  implements IScopedAccountRepository
{
  private readonly store = new Map<string, Account>();

  async findById(id: string): Promise<Account | null> {
    return this.store.get(id) ?? null;
  }

  async findByIdWithLock(id: string): Promise<Account | null> {
    return this.store.get(id) ?? null;
  }

  async findByUserId(userId: string): Promise<Account[]> {
    return Array.from(this.store.values()).filter((a) => a.userId === userId);
  }

  async save(account: Account): Promise<Account> {
    this.store.set(account.id, account);
    return account;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  seed(accounts: Account[]): void {
    for (const a of accounts) this.store.set(a.id, a);
  }

  size(): number {
    return this.store.size;
  }
}
