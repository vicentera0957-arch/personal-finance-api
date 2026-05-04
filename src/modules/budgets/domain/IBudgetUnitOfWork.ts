import { IUnitOfWork } from '../../../shared/domain/IUnitOfWork';
import { IBudgetRepository } from './repository/budgets.repository';
import { IExpenseChecker } from './repository/expense-checker.port';

export abstract class IBudgetUnitOfWork extends IUnitOfWork {
  abstract getBudgetRepository(): IBudgetRepository;
  abstract getScopedExpenseChecker(): IExpenseChecker;
}
