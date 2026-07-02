import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ICategoryRepository } from '../../domain/repository/category.repository';
import { Category } from '../../domain/entities/category.entity';
import {
  DuplicateCategoryException,
  CategoryInUseException,
} from '../../domain/exceptions/category.exceptions';
import { CategoryOrmEntity } from './category.orm.entity';
import { CategoryMapper } from './category.mapper';

@Injectable()
export class CategoryRepositoryImpl extends ICategoryRepository {
  constructor(
    @InjectRepository(CategoryOrmEntity)
    private readonly ormRepository: Repository<CategoryOrmEntity>,
    private readonly mapper: CategoryMapper,
  ) {
    super();
  }

  async findById(id: string): Promise<Category | null> {
    const orm = await this.ormRepository.findOne({ where: { id } });
    if (!orm) return null;
    return this.mapper.toDomain(orm);
  }

  async findByUserId(userId: string): Promise<Category[]> {
    const orms = await this.ormRepository.find({ where: { userId } });
    return orms.map((orm) => this.mapper.toDomain(orm));
  }

  // Busca por combinación userId + name + nature para validar duplicados
  async save(category: Category): Promise<Category> {
    const orm = this.mapper.toOrm(category);
    try {
      const saved = await this.ormRepository.save(orm);
      return this.mapper.toDomain(saved);
    } catch (error) {
      // PostgreSQL unique constraint violation
      if (error?.code === '23505') {
        throw new DuplicateCategoryException(
          category.getName(),
          category.nature.getValue(),
        );
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.ormRepository.delete(id);
    } catch (error) {
      // PostgreSQL FK violation — la categoría tiene transacciones/budgets.
      // 23503 = foreign_key_violation (FKs NO ACTION, y RESTRICT en PG ≤15).
      // 23001 = restrict_violation (FKs ON DELETE RESTRICT en PG nuevos —
      // el PG gestionado de prod lo emite; local PG 15 emitía 23503).
      if (error?.code === '23503' || error?.code === '23001') {
        throw new CategoryInUseException(id);
      }
      throw error;
    }
  }
}
