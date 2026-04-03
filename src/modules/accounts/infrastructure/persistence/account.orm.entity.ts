import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { UserOrmEntity } from '../../../users/infrastructure/persistence/user.orm.entity';

@Entity('accounts')
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
