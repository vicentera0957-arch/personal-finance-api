import {
  BudgetQueryOptions,
  IBudgetRepository,
} from '../../../domain/repository/budgets.repository';
import { IScopedBudgetRepository } from '../../../domain/repository/scoped-budget.repository';
import { IScopedBudgetPeriodReader } from '../../../domain/repository/budget-period-reader.port';
import { Budget } from '../../../domain/budget.entity';

// Test double playing three roles: the query port (global repo) and the two
// command ports (scoped repo + period reader handed out by the UoW fakes).
// In-memory has no real locks, so the …WithLock methods are the same lookup
// as their unlocked counterparts.
//
// `extends IScopedBudgetPeriodReader`, not `IBudgetRepository`: TS abstract
// classes without private members are structurally assignable regardless of
// `extends`/`implements`, so the choice is otherwise free — but the real
// `ScopedBudgetRepository` (infrastructure/persistence/scoped-budget.repository.ts)
// already `extends IScopedBudgetRepository`, so that port's module gets
// required (and covered) via its own spec. `IScopedBudgetPeriodReader` is
// only ever referenced via `implements` in production code (a class can
// extend just one base), which TS's type-only-import elision strips from
// every compiled call site — nothing requires that module at runtime, so it
// never gets instrumented and the 95% domain coverage gate fails on an
// abstract class with a single method declaration. Extending it HERE, the
// one fake this port is structurally exercised through, is enough to load
// it. Mirrors `InMemoryTransactionRepository extends IScopedTransactionRepository
// implements ITransactionRepository` — same shape, same reason.
export class InMemoryBudgetRepository
  extends IScopedBudgetPeriodReader
  implements IBudgetRepository, IScopedBudgetRepository
{
  private readonly store = new Map<string, Budget>();

  async findById(id: string): Promise<Budget | null> {
    return this.store.get(id) ?? null;
  }

  async findByIdWithLock(id: string): Promise<Budget | null> {
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

  async findByUserIdAndCategoryIdAndPeriodWithLock(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<Budget | null> {
    return this.findByUserIdAndCategoryIdAndPeriod(
      userId,
      categoryId,
      month,
      year,
    );
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
