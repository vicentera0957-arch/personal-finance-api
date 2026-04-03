import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
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

  @Column({ name: 'is_budgetable', default: true })
  isBudgetable: boolean;

  // Color e ícono son opcionales — el frontend puede definir defaults visuales
  @Column({ length: 20, nullable: true })
  color: string | null;

  @Column({ length: 50, nullable: true })
  icon: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // updatedAt agregado al esquema original para soportar actualizaciones
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
