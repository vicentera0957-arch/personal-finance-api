import {
  BudgetQueryOptions,
  IBudgetRepository,
} from '../../../domain/repository/budgets.repository';
import { Budget } from '../../../domain/budget.entity';

export class InMemoryBudgetRepository extends IBudgetRepository {
  private readonly store = new Map<string, Budget>();

  async findById(id: string): Promise<Budget | null> {
    return this.store.get(id) ?? null;
  }

  async findByUserId(
    userId: string,
    options?: BudgetQueryOptions,
  ): Promise<Budget[]> {
    return Array.from(this.store.values()).filter((b) => {
      if (b.userId !== userId) return false;
      if (options?.month !== undefined && b.month !== options.month)
        return false;
      if (options?.year !== undefined && b.year !== options.year) return false;
      return true;
    });
  }

  async findByUserIdAndCategoryIdAndPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<Budget | null> {
    for (const b of this.store.values()) {
      if (
        b.userId === userId &&
        b.categoryId === categoryId &&
        b.month === month &&
        b.year === year
      ) {
        return b;
      }
    }
    return null;
  }

  async save(budget: Budget): Promise<Budget> {
    this.store.set(budget.id, budget);
    return budget;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  seed(budgets: Budget[]): void {
    for (const b of budgets) this.store.set(b.id, b);
  }

  size(): number {
    return this.store.size;
  }
}
