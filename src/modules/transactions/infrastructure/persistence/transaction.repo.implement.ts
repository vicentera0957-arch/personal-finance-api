import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ITransactionRepository } from '../../domain/repository/transaction.repository';
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

  async findByAccountId(accountId: string): Promise<Transaction[]> {
    const orms = await this.ormRepository.find({ where: { accountId } });
    return orms.map((orm) => this.mapper.toDomain(orm));
  }

  async findByUserId(userId: string): Promise<Transaction[]> {
    const orms = await this.ormRepository.find({ where: { userId } });
    return orms.map((orm) => this.mapper.toDomain(orm));
  }

  async save(transaction: Transaction): Promise<Transaction> {
    const orm = this.mapper.toOrm(transaction);
    const saved = await this.ormRepository.save(orm);
    return this.mapper.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.ormRepository.delete(id);
  }
}
