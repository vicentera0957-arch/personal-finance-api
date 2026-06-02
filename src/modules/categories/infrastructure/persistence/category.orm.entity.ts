import {
  Entity,
  PrimaryColumn,
  Column,
  Unique,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserOrmEntity } from '../../../users/infrastructure/persistence/user.orm.entity';

// Entidad TypeORM — completamente separada de la entidad de dominio.
// El mapper es el único que traduce entre las dos representaciones.
@Entity('categories')
@Unique(['userId', 'name', 'nature'])
export class CategoryOrmEntity {
  // UUID generado en el use case, no por la DB
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => UserOrmEntity, {
    onDelete: 'CASCADE',
    nullable: false,
    createForeignKeyConstraints: true,
  })
  @JoinColumn({ name: 'user_id' })
  user?: UserOrmEntity;

  @Column({ length: 80 })
  name: string;

  // 'income' o 'expense' — el VO CategoryNature valida esto en el dominio
  @Column({ length: 20 })
  nature: string;

  // Color e ícono son opcionales — el frontend puede definir defaults visuales
  @Column({ type: 'varchar', length: 20, nullable: true })
  color: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  icon: string | null;

  @Column({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
