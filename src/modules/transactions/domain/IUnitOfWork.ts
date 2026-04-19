import { ITransactionRepository } from './repository/transaction.repository';
import { IAccountRepository } from '../../accounts/domain/repository/accounts.repository';

export abstract class IUnitOfWork {
  abstract begin(): Promise<void>;
  abstract commit(): Promise<void>;
  abstract rollback(): Promise<void>;
  abstract release(): Promise<void>;
  abstract isActive(): boolean;
  abstract getTransactionRepository(): ITransactionRepository;
  abstract getAccountRepository(): IAccountRepository;
}
