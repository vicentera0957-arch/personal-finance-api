import { ICategoryRepository } from '../../../domain/repository/category.repository';
import { Category } from '../../../domain/entities/category.entity';

export class InMemoryCategoryRepository extends ICategoryRepository {
  private readonly store = new Map<string, Category>();

  async findById(id: string): Promise<Category | null> {
    return this.store.get(id) ?? null;
  }

  async findByUserId(userId: string): Promise<Category[]> {
    return Array.from(this.store.values()).filter((c) => c.userId === userId);
  }

  async save(category: Category): Promise<Category> {
    this.store.set(category.id, category);
    return category;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  seed(categories: Category[]): void {
    for (const c of categories) this.store.set(c.id, c);
  }

  size(): number {
    return this.store.size;
  }
}
