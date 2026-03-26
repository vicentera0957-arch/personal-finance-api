import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ICategoryRepository } from '../../domain/repository/category.repository';
import { Category } from '../../domain/entities/category.entity';
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
  async findByUserIdAndNameAndNature(
    userId: string,
    name: string,
    nature: string,
  ): Promise<Category | null> {
    const orm = await this.ormRepository.findOne({
      where: { userId, name, nature },
    });
    if (!orm) return null;
    return this.mapper.toDomain(orm);
  }

  async save(category: Category): Promise<Category> {
    const orm = this.mapper.toOrm(category);
    const saved = await this.ormRepository.save(orm);
    return this.mapper.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.ormRepository.delete(id);
  }
}
