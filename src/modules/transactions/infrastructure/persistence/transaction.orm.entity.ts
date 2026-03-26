import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// Entidad TypeORM — completamente separada de la entidad de dominio.
// Sin updatedAt: las transacciones son registros inmutables (ver notas.md).
@Entity('transactions')
export class TransactionOrmEntity {
  // UUID generado en el use case, no por la DB
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'account_id' })
  accountId: string;

  @Column({ name: 'category_id' })
  categoryId: string;

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
