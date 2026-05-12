import { Category } from '../../entities/category.entity';

export abstract class ICategoriesCache {
  abstract getListByUser(userId: string): Promise<Category[] | null>;
  abstract setListByUser(userId: string, categories: Category[]): Promise<void>;
  abstract getById(id: string): Promise<Category | null>;
  abstract setById(category: Category): Promise<void>;
  abstract invalidateUser(userId: string): Promise<void>;
  abstract invalidateById(id: string): Promise<void>;
}
