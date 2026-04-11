import { Injectable } from '@nestjs/common';
import { ICategoryRepository } from '../../domain/repository/category.repository';
import { Category } from '../../domain/entities/category.entity';
import { CategoryNotFoundException } from '../../domain/exceptions/category.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

@Injectable()
export class GetCategoryByIdUseCase {
  constructor(private readonly categoryRepository: ICategoryRepository) {}

  async execute(id: string, requestUserId: string): Promise<Category> {
    const category = await this.categoryRepository.findById(id);
    if (!category) throw new CategoryNotFoundException(id);
    if (category.userId !== requestUserId) {
      throw new ResourceOwnershipException(id);
    }
    return category;
  }
}
