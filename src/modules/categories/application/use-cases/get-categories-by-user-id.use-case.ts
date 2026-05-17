import { Injectable } from '@nestjs/common';
import { ICategoryRepository } from '../../domain/repository/category.repository';
import { ICategoriesCache } from '../../domain/ports/cache/categories-cache.port';
import { Category } from '../../domain/entities/category.entity';

@Injectable()
export class GetCategoriesByUserIdUseCase {
  constructor(
    private readonly categoryRepository: ICategoryRepository,
    private readonly cache: ICategoriesCache,
  ) {}

  async execute(userId: string): Promise<Category[]> {
    const cached = await this.cache.getListByUser(userId);
    if (cached) return cached;

    const categories = await this.categoryRepository.findByUserId(userId);
    await this.cache.setListByUser(userId, categories);
    return categories;
  }
}
