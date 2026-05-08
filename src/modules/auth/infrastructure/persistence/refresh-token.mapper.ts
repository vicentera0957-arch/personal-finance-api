import { Injectable } from '@nestjs/common';
import { RefreshToken } from '../../domain/entities/refresh-token.entity';
import { RefreshTokenOrmEntity } from './refresh-token.orm.entity';

@Injectable()
export class RefreshTokenMapper {
  toDomain(orm: RefreshTokenOrmEntity): RefreshToken {
    return RefreshToken.reconstitute({
      id: orm.id,
      userId: orm.userId,
      familyId: orm.familyId,
      tokenHash: orm.tokenHash,
      expiresAt: orm.expiresAt,
      createdAt: orm.createdAt,
      revokedAt: orm.revokedAt ?? null,
      replacedById: orm.replacedById ?? null,
    });
  }

  toOrm(domain: RefreshToken): RefreshTokenOrmEntity {
    const orm = new RefreshTokenOrmEntity();
    orm.id = domain.id;
    orm.userId = domain.userId;
    orm.familyId = domain.familyId;
    orm.tokenHash = domain.tokenHash;
    orm.expiresAt = domain.expiresAt;
    orm.createdAt = domain.createdAt;
    orm.revokedAt = domain.revokedAt;
    orm.replacedById = domain.replacedById;
    return orm;
  }
}
