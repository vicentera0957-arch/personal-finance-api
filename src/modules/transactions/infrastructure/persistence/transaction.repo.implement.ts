import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  FindOptionsWhere,
  Between,
  MoreThanOrEqual,
  LessThanOrEqual,
} from 'typeorm';
import {
  ITransactionRepository,
  TransactionQueryOptions,
} from '../../domain/repository/transaction.repository';
import { Transaction } from '../../domain/entities/transaction.entity';
import { TransactionOrmEntity } from './transaction.orm.entity';
import { TransactionMapper } from './transaction.mapper';

@Injectable()
export class TransactionRepositoryImpl extends ITransactionRepository {
  constructor(
    @InjectRepository(TransactionOrmEntity)
    private readonly ormRepository: Repository<TransactionOrmEntity>,
    private readonly mapper: TransactionMapper,
  ) {
    super();
  }

  async findById(id: string): Promise<Transaction | null> {
    const orm = await this.ormRepository.findOne({ where: { id } });
    if (!orm) return null;
    return this.mapper.toDomain(orm);
  }

  async findByAccountId(
    accountId: string,
    options?: TransactionQueryOptions,
  ): Promise<Transaction[]> {
    const where: FindOptionsWhere<TransactionOrmEntity> = { accountId };
    this.applyDateFilter(where, options);

    const orms = await this.ormRepository.find({
      where,
      skip: options?.offset,
      take: options?.limit,
      order: { transactionDate: 'DESC' },
    });
    return orms.map((orm) => this.mapper.toDomain(orm));
  }

  async findByUserId(
    userId: string,
    options?: TransactionQueryOptions,
  ): Promise<Transaction[]> {
    const where: FindOptionsWhere<TransactionOrmEntity> = { userId };
    this.applyDateFilter(where, options);

    const orms = await this.ormRepository.find({
      where,
      skip: options?.offset,
      take: options?.limit,
      order: { transactionDate: 'DESC' },
    });
    return orms.map((orm) => this.mapper.toDomain(orm));
  }

  private applyDateFilter(
    where: FindOptionsWhere<TransactionOrmEntity>,
    options?: TransactionQueryOptions,
  ): void {
    if (options?.from && options?.to) {
      where.transactionDate = Between(options.from, options.to);
    } else if (options?.from) {
      where.transactionDate = MoreThanOrEqual(options.from);
    } else if (options?.to) {
      where.transactionDate = LessThanOrEqual(options.to);
    }
  }
}
