import { Injectable } from '@nestjs/common';
import { ICacheStore } from '../../../../shared/domain/cache/cache-store.port';
import { ICategoriesCache } from '../../domain/ports/cache/categories-cache.port';
import { Category } from '../../domain/entities/category.entity';
import { CategoryNature } from '../../domain/value-objects/category-nature.vo';

const TTL_SECONDS = 600;

interface CategoryCacheShape {
  id: string;
  userId: string;
  name: string;
  nature: string;
  color: string | null;
  icon: string | null;
  createdAt: string;
  updatedAt: string;
}

function toShape(c: Category): CategoryCacheShape {
  return {
    id: c.id,
    userId: c.userId,
    name: c.getName(),
    nature: c.nature.getValue(),
    color: c.getColor(),
    icon: c.getIcon(),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.getUpdatedAt().toISOString(),
  };
}

function fromShape(s: CategoryCacheShape): Category {
  return Category.reconstitute({
    id: s.id,
    userId: s.userId,
    name: s.name,
    nature: CategoryNature.reconstitute(s.nature),
    color: s.color ?? undefined,
    icon: s.icon ?? undefined,
    createdAt: new Date(s.createdAt),
    updatedAt: new Date(s.updatedAt),
  });
}

@Injectable()
export class CategoriesCacheImpl extends ICategoriesCache {
  constructor(private readonly store: ICacheStore) {
    super();
  }

  private listKey(userId: string): string {
    return `categories:user:${userId}:list`;
  }

  private itemKey(id: string): string {
    return `categories:item:${id}`;
  }

  async getListByUser(userId: string): Promise<Category[] | null> {
    const shapes = await this.store.get<CategoryCacheShape[]>(this.listKey(userId));
    if (!shapes) return null;
    return shapes.map(fromShape);
  }

  async setListByUser(userId: string, categories: Category[]): Promise<void> {
    await this.store.set(this.listKey(userId), categories.map(toShape), TTL_SECONDS);
  }

  async getById(id: string): Promise<Category | null> {
    const shape = await this.store.get<CategoryCacheShape>(this.itemKey(id));
    if (!shape) return null;
    return fromShape(shape);
  }

  async setById(category: Category): Promise<void> {
    await this.store.set(this.itemKey(category.id), toShape(category), TTL_SECONDS);
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.store.del(this.listKey(userId));
  }

  async invalidateById(id: string): Promise<void> {
    await this.store.del(this.itemKey(id));
  }
}
