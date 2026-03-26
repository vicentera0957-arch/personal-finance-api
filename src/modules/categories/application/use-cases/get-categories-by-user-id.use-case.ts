import { Injectable } from '@nestjs/common';
import { ICategoryRepository } from '../../domain/repository/category.repository';
import { Category } from '../../domain/entities/category.entity';

@Injectable()
export class GetCategoriesByUserIdUseCase {
  constructor(private readonly categoryRepository: ICategoryRepository) {}

  async execute(userId: string): Promise<Category[]> {
    // Array vacío es válido — el usuario puede no tener categorías aún
    return this.categoryRepository.findByUserId(userId);
  }
}
