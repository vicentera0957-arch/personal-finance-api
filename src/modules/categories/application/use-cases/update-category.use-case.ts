import { Injectable } from '@nestjs/common';
import { ICategoryRepository } from '../../domain/repository/category.repository';
import { Category } from '../../domain/entities/category.entity';
import { GetCategoryByIdUseCase } from './get-category-by-id.use-case';

interface UpdateCategoryCommand {
  id: string;
  name?: string;
  isBudgetable?: boolean;
  color?: string;
  icon?: string;
}

@Injectable()
export class UpdateCategoryUseCase {
  constructor(
    private readonly categoryRepository: ICategoryRepository,
    private readonly getCategoryByIdUseCase: GetCategoryByIdUseCase,
  ) {}

  async execute(command: UpdateCategoryCommand): Promise<Category> {
    const category = await this.getCategoryByIdUseCase.execute(command.id);

    // Solo aplica el método si el campo fue enviado en la petición
    if (command.name !== undefined) {
      category.rename(command.name);
    }
    if (command.color !== undefined) {
      category.changeColor(command.color);
    }
    if (command.icon !== undefined) {
      category.changeIcon(command.icon);
    }
    if (command.isBudgetable !== undefined) {
      category.setBudgetable(command.isBudgetable);
    }

    return this.categoryRepository.save(category);
  }
}
