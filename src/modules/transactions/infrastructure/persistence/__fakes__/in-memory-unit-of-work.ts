import { IUnitOfWork } from '../../../domain/IUnitOfWork';
import { ITransactionRepository } from '../../../domain/repository/transaction.repository';
import { IAccountRepository } from '../../../../accounts/domain/repository/accounts.repository';
import { IBudgetRepository } from '../../../../budgets/domain/repository/budgets.repository';

export class InMemoryUnitOfWork extends IUnitOfWork {
  private _commits = 0;
  private _rollbacks = 0;
  private active = false;

  constructor(
    private readonly txRepo: ITransactionRepository,
    private readonly acctRepo: IAccountRepository,
    private readonly budgetRepo?: IBudgetRepository,
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

  getTransactionRepository(): ITransactionRepository {
    return this.txRepo;
  }

  getAccountRepository(): IAccountRepository {
    return this.acctRepo;
  }

  getBudgetRepository(): IBudgetRepository {
    if (!this.budgetRepo) {
      throw new Error('BudgetRepository not provided to InMemoryUnitOfWork');
    }
    return this.budgetRepo;
  }

  commits(): number {
    return this._commits;
  }

  rollbacks(): number {
    return this._rollbacks;
  }
}
