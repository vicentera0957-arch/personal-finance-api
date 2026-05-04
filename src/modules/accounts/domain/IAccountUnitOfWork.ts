import { IUnitOfWork } from '../../../shared/domain/IUnitOfWork';
import { IAccountRepository } from './repository/accounts.repository';

export abstract class IAccountUnitOfWork extends IUnitOfWork {
  abstract getAccountRepository(): IAccountRepository;
}
