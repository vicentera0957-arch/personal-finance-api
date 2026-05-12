import { IUsersCache } from '../../../domain/ports/cache/users-cache.port';
import { User } from '../../../domain/entities/user.entity';

export class NullUsersCache extends IUsersCache {
  async getById(_id: string): Promise<User | null> {
    return null;
  }
  async setById(_user: User): Promise<void> {}
  async invalidateById(_id: string): Promise<void> {}
}
