import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UserOrmEntity } from '../../../users/infrastructure/persistence/user.orm.entity';

// Índice en user_id para `findByUserId` — se llama cada vez que listamos cuentas del usuario.
@Entity('accounts')
@Index('idx_account_user', ['userId'])
export class AccountOrmEntity {
  @PrimaryGeneratedColumn('uuid')
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

  @Column()
  name: string;

  @Column()
  type: string; // AccountType unwrapped

  @Column({ name: 'initial_balance' })
  initialBalance: number; // Balance unwrapped

  @Column({ name: 'current_balance' })
  currentBalance: number; // Balance unwrapped

  @Column({ name: 'is_archived', default: false })
  isArchived: boolean;

  @Column({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
