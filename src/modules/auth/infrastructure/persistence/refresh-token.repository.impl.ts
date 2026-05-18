import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { IRefreshTokenRepository } from '../../domain/repository/refresh-token.repository';
import { RefreshToken } from '../../domain/entities/refresh-token.entity';
import { RefreshTokenOrmEntity } from './refresh-token.orm.entity';
import { RefreshTokenMapper } from './refresh-token.mapper';

@Injectable()
export class RefreshTokenRepositoryImpl extends IRefreshTokenRepository {
  constructor(
    @InjectRepository(RefreshTokenOrmEntity)
    private readonly repo: Repository<RefreshTokenOrmEntity>,
    private readonly mapper: RefreshTokenMapper,
  ) {
    super();
  }

  async findByTokenHash(hash: string): Promise<RefreshToken | null> {
    const orm = await this.repo.findOne({ where: { tokenHash: hash } });
    return orm ? this.mapper.toDomain(orm) : null;
  }

  async findByTokenHashWithLock(hash: string): Promise<RefreshToken | null> {
    const orm = await this.repo.findOne({
      where: { tokenHash: hash },
      lock: { mode: 'pessimistic_write' },
    });
    return orm ? this.mapper.toDomain(orm) : null;
  }

  async save(token: RefreshToken): Promise<void> {
    await this.repo.save(this.mapper.toOrm(token));
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(RefreshTokenOrmEntity)
      .set({ revokedAt: () => 'NOW()' })
      .where('family_id = :familyId AND revoked_at IS NULL', { familyId })
      .execute();
  }

  async deleteExpired(now: Date): Promise<number> {
    const result = await this.repo.delete({ expiresAt: LessThan(now) });
    return result.affected ?? 0;
  }
}
