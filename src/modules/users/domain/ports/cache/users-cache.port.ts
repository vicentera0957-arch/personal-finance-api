import { User } from '../../../entities/user.entity';

export abstract class IUsersCache {
  abstract getById(id: string): Promise<User | null>;
  abstract setById(user: User): Promise<void>;
  abstract invalidateById(id: string): Promise<void>;
}
