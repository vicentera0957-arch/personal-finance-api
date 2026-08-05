import {
  ITransactionUnitOfWork,
  TransactionTxContext,
} from '../../../domain/ITransactionUnitOfWork';
import {
  BudgetTxContext,
  IBudgetUnitOfWork,
} from '../../../../budgets/domain/IBudgetUnitOfWork';
import { IScopedTransactionRepository } from '../../../domain/repository/scoped-transaction.repository';
import { IScopedAccountRepository } from '../../../../accounts/domain/repository/scoped-account.repository';
import { IScopedBudgetRepository } from '../../../../budgets/domain/repository/scoped-budget.repository';
import { IScopedBudgetPeriodReader } from '../../../../budgets/domain/repository/budget-period-reader.port';
import { IExpenseChecker } from '../../../../budgets/domain/ports/expense-checker.port';

// Este fake sirve DOS puertos (ITransactionUnitOfWork y IBudgetUnitOfWork),
// así que su run() necesita un contexto que satisfaga ambos TCtx a la vez.
// Tras P5 esto ya no requiere una intersección en `budgets`: cada puerto
// pide una propiedad distinta (`budgetPeriodReader` vs. `budgets`), así que
// no hay dos tipos incompatibles compartiendo un nombre.
type InMemoryTxContext = TransactionTxContext & BudgetTxContext;

export class InMemoryUnitOfWork
  extends ITransactionUnitOfWork
  implements IBudgetUnitOfWork
{
  private _commits = 0;
  private _rollbacks = 0;

  constructor(
    private readonly txRepo: IScopedTransactionRepository,
    private readonly acctRepo: IScopedAccountRepository,
    private readonly budgetRepo?: IScopedBudgetRepository &
      IScopedBudgetPeriodReader,
    private readonly expenseChecker?: IExpenseChecker,
  ) {
    super();
  }

  // CRÍTICO: el contexto se construye con getters PEREZOSOS, no eager. Si
  // budgetRepo/expenseChecker faltaran y esto los leyera ansiosamente acá,
  // delete-transaction.use-case.spec.ts:25 (que construye este fake SIN
  // budgetRepo) rompería aunque DeleteTransaction nunca toque esa propiedad.
  // Un objeto literal con `get budgets() { … }` preserva esa pereza.
  async run<T>(work: (ctx: InMemoryTxContext) => Promise<T>): Promise<T> {
    const txRepo = this.txRepo;
    const acctRepo = this.acctRepo;
    const budgetRepo = this.budgetRepo;
    const expenseChecker = this.expenseChecker;
    try {
      const result = await work({
        transactions: txRepo,
        accounts: acctRepo,
        get budgetPeriodReader(): IScopedBudgetPeriodReader {
          if (!budgetRepo) {
            throw new Error(
              'BudgetRepository not provided to InMemoryUnitOfWork',
            );
          }
          return budgetRepo;
        },
        get budgets(): IScopedBudgetRepository {
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
    }
  }

  commits(): number {
    return this._commits;
  }

  rollbacks(): number {
    return this._rollbacks;
  }
}
