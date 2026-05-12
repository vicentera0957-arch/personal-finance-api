import { Injectable } from '@nestjs/common';
import { ICategoryRepository } from '../../domain/repository/category.repository';
import { ICategoriesCache } from '../../domain/ports/cache/categories-cache.port';
import { Category } from '../../domain/entities/category.entity';
import { GetCategoryByIdUseCase } from './get-category-by-id.use-case';

interface UpdateCategoryCommand {
  id: string;
  name?: string;
  color?: string;
  icon?: string;
  requestUserId: string;
}

@Injectable()
export class UpdateCategoryUseCase {
  constructor(
    private readonly categoryRepository: ICategoryRepository,
    private readonly getCategoryByIdUseCase: GetCategoryByIdUseCase,
    private readonly cache: ICategoriesCache,
  ) {}

  async execute(command: UpdateCategoryCommand): Promise<Category> {
    const category = await this.getCategoryByIdUseCase.execute(
      command.id,
      command.requestUserId,
    );

    if (command.name !== undefined) category.rename(command.name);
    if (command.color !== undefined) category.changeColor(command.color);
    if (command.icon !== undefined) category.changeIcon(command.icon);

    const saved = await this.categoryRepository.save(category);
    await Promise.all([
      this.cache.invalidateUser(saved.userId),
      this.cache.invalidateById(saved.id),
    ]);
    return saved;
  }
}
