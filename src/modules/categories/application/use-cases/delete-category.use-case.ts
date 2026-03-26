import { Injectable } from '@nestjs/common';
import { ICategoryRepository } from '../../domain/repository/category.repository';
import { GetCategoryByIdUseCase } from './get-category-by-id.use-case';

@Injectable()
export class DeleteCategoryUseCase {
  constructor(
    private readonly categoryRepository: ICategoryRepository,
    private readonly getCategoryByIdUseCase: GetCategoryByIdUseCase,
  ) {}

  async execute(id: string): Promise<void> {
    // Verifica que la categoría existe antes de intentar borrarla (retorna 404 si no)
    await this.getCategoryByIdUseCase.execute(id);
    await this.categoryRepository.delete(id);
  }
}
