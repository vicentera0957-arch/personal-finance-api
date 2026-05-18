import { IBudgetsCache } from '../../../domain/ports/cache/budgets-cache.port';
import { Budget } from '../../../domain/budget.entity';
import { BudgetQueryOptions } from '../../../domain/repository/budgets.repository';

export class NullBudgetsCache extends IBudgetsCache {
  async getListByUser(
    _userId: string,
    _options?: BudgetQueryOptions,
  ): Promise<Budget[] | null> {
    return null;
  }
  async setListByUser(
    _userId: string,
    _options: BudgetQueryOptions | undefined,
    _budgets: Budget[],
  ): Promise<void> {}
  async getById(_id: string): Promise<Budget | null> {
    return null;
  }
  async setById(_budget: Budget): Promise<void> {}
  async invalidateUser(_userId: string): Promise<void> {}
  async invalidateById(_id: string): Promise<void> {}
}
