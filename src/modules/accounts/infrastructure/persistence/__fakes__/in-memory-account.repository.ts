import { IAccountRepository } from '../../../domain/repository/accounts.repository';
import { Account } from '../../../domain/entities/account.entity';

export class InMemoryAccountRepository extends IAccountRepository {
  private readonly store = new Map<string, Account>();

  async findById(id: string): Promise<Account | null> {
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
