import { IUserRepository } from '../../../domain/repository/user.repository';
import { User } from '../../../domain/entities/user.entity';

export class InMemoryUserRepository extends IUserRepository {
  private readonly store = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.store.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.store.values()) {
      if (user.email.getValue() === email) return user;
    }
    return null;
  }

  async save(user: User): Promise<User> {
    this.store.set(user.id, user);
    return user;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  seed(users: User[]): void {
    for (const u of users) this.store.set(u.id, u);
  }

  size(): number {
    return this.store.size;
  }
}
