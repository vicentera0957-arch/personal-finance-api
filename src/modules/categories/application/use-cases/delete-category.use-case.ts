import { Injectable } from '@nestjs/common';
import { ICategoryRepository } from '../../domain/repository/category.repository';
import { ICategoriesCache } from '../../domain/ports/cache/categories-cache.port';
import { GetCategoryByIdUseCase } from './get-category-by-id.use-case';

@Injectable()
export class DeleteCategoryUseCase {
  constructor(
    private readonly categoryRepository: ICategoryRepository,
    private readonly getCategoryByIdUseCase: GetCategoryByIdUseCase,
    private readonly cache: ICategoriesCache,
  ) {}

  async execute(id: string, requestUserId: string): Promise<void> {
    const category = await this.getCategoryByIdUseCase.execute(
      id,
      requestUserId,
    );
    await this.categoryRepository.delete(id);
    await Promise.all([
      this.cache.invalidateUser(category.userId),
      this.cache.invalidateById(id),
    ]);
  }
}
