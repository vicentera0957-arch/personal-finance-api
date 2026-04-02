import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner } from 'typeorm';
import { IAccountRepository } from '../../domain/repository/accounts.repository';
import { Account } from '../../domain/entities/account.entity';
import { AccountOrmEntity } from './account.orm.entity';
import { AccountMapper } from './account.mapper';

@Injectable()
export class AccountRepositoryImpl extends IAccountRepository {
  constructor(
    @InjectRepository(AccountOrmEntity)
    private readonly ormRepository: Repository<AccountOrmEntity>,

    private readonly mapper: AccountMapper,
  ) {
    super();
  }

  async findById(id: string): Promise<Account | null> {
    const orm = await this.ormRepository.findOne({ where: { id } });

    if (!orm) return null;

    return this.mapper.toDomain(orm);
  }

  async findByUserId(userId: string): Promise<Account[]> {
    const orms = await this.ormRepository.find({ where: { userId } });

    return orms.map((orm) => this.mapper.toDomain(orm));
  }

  async save(account: Account, queryRunner?: QueryRunner): Promise<Account> {
    const orm = this.mapper.toOrm(account);
    const saved = queryRunner
      ? await queryRunner.manager.save(AccountOrmEntity, orm)
      : await this.ormRepository.save(orm);
    return this.mapper.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.ormRepository.delete(id);
  }
}
