import { ICategoriesCache } from '../../../domain/ports/cache/categories-cache.port';
import { Category } from '../../../domain/entities/category.entity';

export class NullCategoriesCache extends ICategoriesCache {
  async getListByUser(_userId: string): Promise<Category[] | null> {
    return null;
  }
  async setListByUser(_userId: string, _categories: Category[]): Promise<void> {}
  async getById(_id: string): Promise<Category | null> {
    return null;
  }
  async setById(_category: Category): Promise<void> {}
  async invalidateUser(_userId: string): Promise<void> {}
  async invalidateById(_id: string): Promise<void> {}
}
