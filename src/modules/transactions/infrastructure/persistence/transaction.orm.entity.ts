import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserOrmEntity } from '../../../users/infrastructure/persistence/user.orm.entity';
import { AccountOrmEntity } from '../../../accounts/infrastructure/persistence/account.orm.entity';
import { CategoryOrmEntity } from '../../../categories/infrastructure/persistence/category.orm.entity';

// Entidad TypeORM — completamente separada de la entidad de dominio.
// Sin updatedAt: las transacciones son registros inmutables (ver notas.md).
@Entity('transactions')
export class TransactionOrmEntity {
  // UUID generado en el use case, no por la DB
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => UserOrmEntity, {
    onDelete: 'CASCADE',
    nullable: false,
    createForeignKeyConstraints: true,
  })
  @JoinColumn({ name: 'user_id' })
  user?: UserOrmEntity;

  @Column({ name: 'account_id' })
  accountId: string;

  // FK constraint hacia accounts — RESTRICT impide eliminar cuenta con transacciones.
  @ManyToOne(() => AccountOrmEntity, {
    onDelete: 'RESTRICT',
    nullable: false,
    createForeignKeyConstraints: true,
  })
  @JoinColumn({ name: 'account_id' })
  account?: AccountOrmEntity;

  @Column({ name: 'category_id' })
  categoryId: string;

  // FK constraint hacia categories — onDelete: RESTRICT impide eliminar una categoría con transacciones.
  // synchronize: true crea el constraint automáticamente al arrancar.
  @ManyToOne(() => CategoryOrmEntity, {
    onDelete: 'RESTRICT',
    nullable: false,
    createForeignKeyConstraints: true,
  })
  @JoinColumn({ name: 'category_id' })
  category?: CategoryOrmEntity;

  // 'income' o 'expense' — el VO TransactionNature valida esto en el dominio
  @Column({ length: 20 })
  nature: string;

  // Monto en CLP (entero, sin decimales) — igual que Balance en accounts
  @Column({ type: 'int' })
  amount: number;

  @Column({ length: 255, nullable: true })
  description: string | null;

  // Fecha real del movimiento — puede diferir de createdAt (registro posterior)
  @Column({ name: 'transaction_date', type: 'timestamp' })
  transactionDate: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
