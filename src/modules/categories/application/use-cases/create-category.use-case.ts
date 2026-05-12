import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ICategoryRepository } from '../../domain/repository/category.repository';
import { ICategoriesCache } from '../../domain/ports/cache/categories-cache.port';
import { Category } from '../../domain/entities/category.entity';
import { CategoryNature } from '../../domain/value-objects/category-nature.vo';

interface CreateCategoryCommand {
  userId: string;
  name: string;
  nature: string;
  color?: string;
  icon?: string;
}

@Injectable()
export class CreateCategoryUseCase {
  constructor(
    private readonly categoryRepository: ICategoryRepository,
    private readonly cache: ICategoriesCache,
  ) {}

  async execute(command: CreateCategoryCommand): Promise<Category> {
    const nature = CategoryNature.create(command.nature);

    const category = Category.create({
      id: randomUUID(),
      userId: command.userId,
      name: command.name,
      nature,
      color: command.color,
      icon: command.icon,
    });

    const saved = await this.categoryRepository.save(category);
    await this.cache.invalidateUser(saved.userId);
    return saved;
  }
}
