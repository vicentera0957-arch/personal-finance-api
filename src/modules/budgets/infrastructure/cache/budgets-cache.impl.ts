import { Injectable } from '@nestjs/common';
import { ICacheStore } from '../../../../shared/domain/cache/cache-store.port';
import { IBudgetsCache } from '../../domain/ports/cache/budgets-cache.port';
import { Budget } from '../../domain/budget.entity';
import { AmountLimit } from '../../domain/amountlimit.vo';
import { BudgetQueryOptions } from '../../domain/repository/budgets.repository';

const TTL_SECONDS = 600;

interface BudgetCacheShape {
  id: string;
  userId: string;
  categoryId: string;
  month: number;
  year: number;
  limit: number;
  createdAt: string;
  updatedAt: string;
}

function toShape(b: Budget): BudgetCacheShape {
  return {
    id: b.id,
    userId: b.userId,
    categoryId: b.categoryId,
    month: b.month,
    year: b.year,
    limit: b.getLimit().getValue(),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.getUpdatedAt().toISOString(),
  };
}

function fromShape(s: BudgetCacheShape): Budget {
  return Budget.reconstitute({
    id: s.id,
    userId: s.userId,
    categoryId: s.categoryId,
    month: s.month,
    year: s.year,
    limit: AmountLimit.reconstitute(s.limit),
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  });
}

@Injectable()
export class BudgetsCacheImpl extends IBudgetsCache {
  constructor(private readonly store: ICacheStore) {
    super();
  }

  private listKey(userId: string, options?: BudgetQueryOptions): string {
    if (options?.month !== undefined && options?.year !== undefined) {
      return `budgets:user:${userId}:list:${options.year}-${options.month}`;
    }
    return `budgets:user:${userId}:list:all`;
  }

  private itemKey(id: string): string {
    return `budgets:item:${id}`;
  }

  async getListByUser(userId: string, options?: BudgetQueryOptions): Promise<Budget[] | null> {
    const shapes = await this.store.get<BudgetCacheShape[]>(this.listKey(userId, options));
    if (!shapes) return null;
    return shapes.map(fromShape);
  }

  async setListByUser(userId: string, options: BudgetQueryOptions | undefined, budgets: Budget[]): Promise<void> {
    await this.store.set(this.listKey(userId, options), budgets.map(toShape), TTL_SECONDS);
  }

  async getById(id: string): Promise<Budget | null> {
    const shape = await this.store.get<BudgetCacheShape>(this.itemKey(id));
    if (!shape) return null;
    return fromShape(shape);
  }

  async setById(budget: Budget): Promise<void> {
    await this.store.set(this.itemKey(budget.id), toShape(budget), TTL_SECONDS);
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.store.delByPrefix(`budgets:user:${userId}:list`);
  }

  async invalidateById(id: string): Promise<void> {
    await this.store.del(this.itemKey(id));
  }
}
