import { ITransactionUnitOfWork } from '../../../domain/ITransactionUnitOfWork';
import { IBudgetUnitOfWork } from '../../../../budgets/domain/IBudgetUnitOfWork';
import { IScopedTransactionRepository } from '../../../domain/repository/scoped-transaction.repository';
import { IAccountRepository } from '../../../../accounts/domain/repository/accounts.repository';
import { IBudgetRepository } from '../../../../budgets/domain/repository/budgets.repository';
import { IExpenseChecker } from '../../../../budgets/domain/repository/expense-checker.port';

export class InMemoryUnitOfWork
  extends ITransactionUnitOfWork
  implements IBudgetUnitOfWork
{
  private _commits = 0;
  private _rollbacks = 0;
  private active = false;

  constructor(
    private readonly txRepo: IScopedTransactionRepository,
    private readonly acctRepo: IAccountRepository,
    private readonly budgetRepo?: IBudgetRepository,
    private readonly expenseChecker?: IExpenseChecker,
  ) {
    super();
  }

  async begin(): Promise<void> {
    this.active = true;
  }

  async commit(): Promise<void> {
    this._commits++;
    this.active = false;
  }

  async rollback(): Promise<void> {
    this._rollbacks++;
    this.active = false;
  }

  async release(): Promise<void> {}

  isActive(): boolean {
    return this.active;
  }

  getScopedTransactionRepository(): IScopedTransactionRepository {
    return this.txRepo;
  }

  getScopedAccountRepository(): IAccountRepository {
    return this.acctRepo;
  }

  getScopedBudgetRepository(): IBudgetRepository {
    if (!this.budgetRepo) {
      throw new Error('BudgetRepository not provided to InMemoryUnitOfWork');
    }
    return this.budgetRepo;
  }

  getScopedExpenseChecker(): IExpenseChecker {
    if (!this.expenseChecker) {
      throw new Error('ExpenseChecker not provided to InMemoryUnitOfWork');
    }
    return this.expenseChecker;
  }

  commits(): number {
    return this._commits;
  }

  rollbacks(): number {
    return this._rollbacks;
  }
}
