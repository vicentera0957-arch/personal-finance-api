import { Injectable } from '@nestjs/common';
import { ICacheStore } from '../../../../shared/domain/cache/cache-store.port';
import { IUsersCache } from '../../domain/ports/cache/users-cache.port';
import { User } from '../../domain/entities/user.entity';
import { Email } from '../../domain/value-objects/email.vo';

const TTL_SECONDS = 600;

interface UserCacheShape {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

function toShape(u: User): UserCacheShape {
  return {
    id: u.id,
    email: u.email.getValue(),
    passwordHash: u.getPasswordHash(),
    name: u.getName(),
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.getUpdatedAt().toISOString(),
  };
}

function fromShape(s: UserCacheShape): User {
  return User.reconstitute({
    id: s.id,
    email: Email.create(s.email),
    passwordHash: s.passwordHash,
    name: s.name,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  });
}

@Injectable()
export class UsersCacheImpl extends IUsersCache {
  constructor(private readonly store: ICacheStore) {
    super();
  }

  private itemKey(id: string): string {
    return `users:item:${id}`;
  }

  async getById(id: string): Promise<User | null> {
    const shape = await this.store.get<UserCacheShape>(this.itemKey(id));
    if (!shape) return null;
    return fromShape(shape);
  }

  async setById(user: User): Promise<void> {
    await this.store.set(this.itemKey(user.id), toShape(user), TTL_SECONDS);
  }

  async invalidateById(id: string): Promise<void> {
    await this.store.del(this.itemKey(id));
  }
}
