import {
  ITransactionUnitOfWork,
  TransactionTxContext,
} from '../../../domain/ITransactionUnitOfWork';
import {
  BudgetTxContext,
  IBudgetUnitOfWork,
} from '../../../../budgets/domain/IBudgetUnitOfWork';
import { IScopedTransactionRepository } from '../../../domain/repository/scoped-transaction.repository';
import { IAccountRepository } from '../../../../accounts/domain/repository/accounts.repository';
import { IBudgetRepository } from '../../../../budgets/domain/repository/budgets.repository';
import { IExpenseChecker } from '../../../../budgets/domain/ports/expense-checker.port';

// Este fake sirve DOS puertos (ITransactionUnitOfWork y IBudgetUnitOfWork),
// así que su run() necesita un contexto que satisfaga ambos TCtx a la vez.
type InMemoryTxContext = TransactionTxContext & BudgetTxContext;

export class InMemoryUnitOfWork
  extends ITransactionUnitOfWork
  implements IBudgetUnitOfWork
{
  private _commits = 0;
  private _rollbacks = 0;
  private connected = false;

  constructor(
    private readonly txRepo: IScopedTransactionRepository,
    private readonly acctRepo: IAccountRepository,
    private readonly budgetRepo?: IBudgetRepository,
    private readonly expenseChecker?: IExpenseChecker,
  ) {
    super();
  }

  async begin(): Promise<void> {
    this.connected = true;
  }

  async commit(): Promise<void> {
    this._commits++;
  }

  async rollback(): Promise<void> {
    this._rollbacks++;
  }

  async release(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
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

  // CRÍTICO: el contexto se construye con getters PEREZOSOS, no eager. Si
  // budgetRepo/expenseChecker faltaran y esto los leyera ansiosamente acá,
  // delete-transaction.use-case.spec.ts:25 (que construye este fake SIN
  // budgetRepo) rompería aunque DeleteTransaction nunca toque ese getter.
  // Un objeto literal con `get budgets() { … }` preserva la pereza original
  // de getScopedBudgetRepository()/getScopedExpenseChecker().
  async run<T>(work: (ctx: InMemoryTxContext) => Promise<T>): Promise<T> {
    this.connected = true;
    const txRepo = this.txRepo;
    const acctRepo = this.acctRepo;
    const budgetRepo = this.budgetRepo;
    const expenseChecker = this.expenseChecker;
    try {
      const result = await work({
        transactions: txRepo,
        accounts: acctRepo,
        get budgets(): IBudgetRepository {
          if (!budgetRepo) {
            throw new Error(
              'BudgetRepository not provided to InMemoryUnitOfWork',
            );
          }
          return budgetRepo;
        },
        get expenses(): IExpenseChecker {
          if (!expenseChecker) {
            throw new Error(
              'ExpenseChecker not provided to InMemoryUnitOfWork',
            );
          }
          return expenseChecker;
        },
      });
      this._commits++;
      return result;
    } catch (err) {
      this._rollbacks++;
      throw err;
    } finally {
      this.connected = false;
    }
  }

  commits(): number {
    return this._commits;
  }

  rollbacks(): number {
    return this._rollbacks;
  }
}
