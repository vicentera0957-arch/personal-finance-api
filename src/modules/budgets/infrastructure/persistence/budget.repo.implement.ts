import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import {
  BudgetQueryOptions,
  IBudgetRepository,
} from '../../domain/repository/budgets.repository';
import { Budget } from '../../domain/budget.entity';
import { BudgetAlreadyExistsException } from '../../domain/exceptions/budget.exceptions';
import { BudgetOrmEntity } from './budget.orm.entity';
import { BudgetMapper } from './budget.mapper';

@Injectable()
export class BudgetRepositoryImpl extends IBudgetRepository {
  constructor(
    @InjectRepository(BudgetOrmEntity)
    private readonly ormRepository: Repository<BudgetOrmEntity>,
    private readonly mapper: BudgetMapper,
  ) {
    super();
  }

  // No lock — query/read path. The FOR UPDATE variant lives in ScopedBudgetRepository (UoW).
  async findById(id: string): Promise<Budget | null> {
    const orm = await this.ormRepository.findOne({ where: { id } });
    if (!orm) return null;
    return this.mapper.toDomain(orm);
  }

  async findByUserId(
    userId: string,
    options?: BudgetQueryOptions,
  ): Promise<Budget[]> {
    const where: FindOptionsWhere<BudgetOrmEntity> = { userId };

    if (options?.month !== undefined) {
      where.month = options.month;
    }
    if (options?.year !== undefined) {
      where.year = options.year;
    }

    const orms = await this.ormRepository.find({
      where,
      order: {
        year: 'DESC',
        month: 'DESC',
      },
    });

    return orms.map((orm) => this.mapper.toDomain(orm));
  }

  // No lock — pre-check/query path. The FOR UPDATE variant lives in ScopedBudgetRepository (UoW).
  async findByUserIdAndCategoryIdAndPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<Budget | null> {
    const orm = await this.ormRepository.findOne({
      where: {
        userId,
        categoryId,
        month,
        year,
      },
    });

    if (!orm) return null;

    return this.mapper.toDomain(orm);
  }

  async save(budget: Budget): Promise<Budget> {
    const orm = this.mapper.toOrm(budget);
    try {
      const saved = await this.ormRepository.save(orm);
      return this.mapper.toDomain(saved);
    } catch (error) {
      // PostgreSQL unique constraint violation on (userId, categoryId, month, year)
      if ((error as { code?: string })?.code === '23505') {
        throw new BudgetAlreadyExistsException(
          budget.userId,
          budget.categoryId,
          budget.month,
          budget.year,
        );
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await this.ormRepository.delete(id);
  }
}
