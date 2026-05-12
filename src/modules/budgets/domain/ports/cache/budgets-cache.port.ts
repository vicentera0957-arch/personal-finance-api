import { Budget } from '../../budget.entity';
import { BudgetQueryOptions } from '../../repository/budgets.repository';

export abstract class IBudgetsCache {
  abstract getListByUser(
    userId: string,
    options?: BudgetQueryOptions,
  ): Promise<Budget[] | null>;
  abstract setListByUser(
    userId: string,
    options: BudgetQueryOptions | undefined,
    budgets: Budget[],
  ): Promise<void>;
  abstract getById(id: string): Promise<Budget | null>;
  abstract setById(budget: Budget): Promise<void>;
  abstract invalidateUser(userId: string): Promise<void>;
  abstract invalidateById(id: string): Promise<void>;
}
