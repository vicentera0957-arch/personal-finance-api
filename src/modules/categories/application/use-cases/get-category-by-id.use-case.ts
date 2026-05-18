import { Injectable } from '@nestjs/common';
import { ICategoryRepository } from '../../domain/repository/category.repository';
import { ICategoriesCache } from '../../domain/ports/cache/categories-cache.port';
import { Category } from '../../domain/entities/category.entity';
import { CategoryNotFoundException } from '../../domain/exceptions/category.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

@Injectable()
export class GetCategoryByIdUseCase {
  constructor(
    private readonly categoryRepository: ICategoryRepository,
    private readonly cache: ICategoriesCache,
  ) {}

  async execute(id: string, requestUserId: string): Promise<Category> {
    const cached = await this.cache.getById(id);
    const category = cached ?? (await this.categoryRepository.findById(id));

    if (!category) throw new CategoryNotFoundException(id);
    if (category.userId !== requestUserId)
      throw new ResourceOwnershipException(id);

    if (!cached) await this.cache.setById(category);
    return category;
  }
}
