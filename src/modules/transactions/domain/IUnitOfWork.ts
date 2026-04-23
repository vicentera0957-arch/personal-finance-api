import { ITransactionRepository } from './repository/transaction.repository';
import { IAccountRepository } from '../../accounts/domain/repository/accounts.repository';
import { IBudgetRepository } from '../../budgets/domain/repository/budgets.repository';

export abstract class IUnitOfWork {
  abstract begin(): Promise<void>;
  abstract commit(): Promise<void>;
  abstract rollback(): Promise<void>;
  abstract release(): Promise<void>;
  abstract isActive(): boolean;
  abstract getTransactionRepository(): ITransactionRepository;
  abstract getAccountRepository(): IAccountRepository;
  abstract getBudgetRepository(): IBudgetRepository;
}
