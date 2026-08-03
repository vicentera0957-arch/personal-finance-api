import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { AuthTxContext, IAuthUnitOfWork } from '../../domain/IAuthUnitOfWork';
import { IRefreshTokenRepository } from '../../domain/repository/refresh-token.repository';
import { RefreshToken } from '../../domain/entities/refresh-token.entity';
import { RefreshTokenOrmEntity } from './refresh-token.orm.entity';
import { RefreshTokenMapper } from './refresh-token.mapper';
import { TypeOrmTransactionRunner } from '../../../../shared/infrastructure/persistence/typeorm-transaction-runner';

// ── Repo escopado — usa el EntityManager del QueryRunner activo ───────────────

class ScopedRefreshTokenRepository extends IRefreshTokenRepository {
  constructor(
    private readonly manager: EntityManager,
    private readonly mapper: RefreshTokenMapper,
  ) {
    super();
  }

  async findByTokenHash(hash: string): Promise<RefreshToken | null> {
    const orm = await this.manager.findOne(RefreshTokenOrmEntity, {
      where: { tokenHash: hash },
    });
    return orm ? this.mapper.toDomain(orm) : null;
  }

  async findByTokenHashWithLock(hash: string): Promise<RefreshToken | null> {
    const orm = await this.manager.findOne(RefreshTokenOrmEntity, {
      where: { tokenHash: hash },
      lock: { mode: 'pessimistic_write' },
    });
    return orm ? this.mapper.toDomain(orm) : null;
  }

  async save(token: RefreshToken): Promise<void> {
    await this.manager.save(RefreshTokenOrmEntity, this.mapper.toOrm(token));
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.manager
      .createQueryBuilder()
      .update(RefreshTokenOrmEntity)
      .set({ revokedAt: () => 'NOW()' })
      .where('family_id = :familyId AND revoked_at IS NULL', { familyId })
      .execute();
  }

  async deleteExpired(now: Date): Promise<number> {
    const result = await this.manager
      .createQueryBuilder()
      .delete()
      .from(RefreshTokenOrmEntity)
      .where('expires_at < :now', { now })
      .execute();
    return result.affected ?? 0;
  }
}

// ── Implementación del UoW ─────────────────────────────────────────────────────

@Injectable()
export class AuthUnitOfWorkImpl
  extends TypeOrmTransactionRunner<AuthTxContext>
  implements IAuthUnitOfWork
{
  constructor(
    dataSource: DataSource,
    private readonly mapper: RefreshTokenMapper,
  ) {
    super(dataSource);
  }

  protected createContext(queryRunner: QueryRunner): AuthTxContext {
    return {
      refreshTokens: new ScopedRefreshTokenRepository(
        queryRunner.manager,
        this.mapper,
      ),
    };
  }
}
