import { QueryRunner } from 'typeorm';
import { Account } from '../entities/account.entity';

export abstract class IAccountRepository {
  abstract findById(id: string): Promise<Account | null>;
  abstract findByUserId(userId: string): Promise<Account[]>;
  abstract save(account: Account, queryRunner?: QueryRunner): Promise<Account>;
  abstract delete(id: string): Promise<void>;
}
