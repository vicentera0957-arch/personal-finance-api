import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserOrmEntity } from '../../../users/infrastructure/persistence/user.orm.entity';

@Entity('refresh_tokens')
// UNIQUE, no índice normal: token_hash es la clave de lookup (findByTokenHash).
// El hash deriva de un JWT con jti=uuidv4 único por emisión, así que dos filas
// nunca pueden colisionar legítimamente — la constraint garantiza esa invariante
// a nivel DB en vez de confiar solo en la lógica de aplicación.
@Index('idx_refresh_tokens_token_hash', ['tokenHash'], { unique: true })
@Index('idx_refresh_tokens_family_id', ['familyId'])
@Index('idx_refresh_tokens_user_id', ['userId'])
export class RefreshTokenOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => UserOrmEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user?: UserOrmEntity;

  @Column({ name: 'family_id', type: 'uuid' })
  familyId: string;

  @Column({ name: 'token_hash', length: 255 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  // Plain @Column — el dominio controla createdAt, no TypeORM.
  @Column({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'replaced_by_id', type: 'uuid', nullable: true })
  replacedById: string | null;

  // FK auto-referencial hacia el token que reemplazó a éste en la rotación.
  // ON DELETE SET NULL: si el job de limpieza borra el token nuevo, el viejo
  // conserva su fila pero pierde el puntero — no se rompe la integridad.
  // La columna escalar `replacedById` arriba es la que lee/escribe el mapper;
  // esta relación solo aporta la constraint (mismo patrón que userId/user).
  @ManyToOne(() => RefreshTokenOrmEntity, {
    onDelete: 'SET NULL',
    nullable: true,
    createForeignKeyConstraints: true,
  })
  @JoinColumn({ name: 'replaced_by_id' })
  replacedBy?: RefreshTokenOrmEntity | null;
}
