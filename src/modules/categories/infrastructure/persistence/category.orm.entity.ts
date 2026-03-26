import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

// Entidad TypeORM — completamente separada de la entidad de dominio.
// El mapper es el único que traduce entre las dos representaciones.
@Entity('categories')
export class CategoryOrmEntity {
  // UUID generado en el use case, no por la DB
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

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
