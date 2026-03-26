import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ICategoryRepository } from '../../domain/repository/category.repository';
import { Category } from '../../domain/entities/category.entity';
import { CategoryNature } from '../../domain/value-objects/category-nature.vo';
import { DuplicateCategoryException } from '../../domain/exceptions/category.exceptions';

interface CreateCategoryCommand {
  userId: string;
  name: string;
  nature: string;
  isBudgetable: boolean;
  color?: string;
  icon?: string;
}

@Injectable()
export class CreateCategoryUseCase {
  constructor(private readonly categoryRepository: ICategoryRepository) {}

  async execute(command: CreateCategoryCommand): Promise<Category> {
    // Valida que la naturaleza sea income o expense (lanza error si no)
    const nature = CategoryNature.create(command.nature);

    // Verifica que no exista ya una categoría con mismo nombre y naturaleza para este usuario
    const existente = await this.categoryRepository.findByUserIdAndNameAndNature(
      command.userId,
      command.name.trim(),
      nature.getValue(),
    );

    if (existente) {
      throw new DuplicateCategoryException(command.name, nature.getValue());
    }

    const category = Category.create({
      id: randomUUID(),
      userId: command.userId,
      name: command.name,
      nature,
      isBudgetable: command.isBudgetable,
      color: command.color,
      icon: command.icon,
    });

    return this.categoryRepository.save(category);
  }
}
