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
import { CategoryOrmEntity } from '../../../categories/infrastructure/persistence/category.orm.entity';

@Entity('budgets')
@Unique('UQ_budgets_user_category_period', [
  'userId',
  'categoryId',
  'month',
  'year',
])
@Index(['userId', 'month', 'year'])
export class BudgetOrmEntity {
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

  @Column({ name: 'category_id' })
  categoryId: string;

  @ManyToOne(() => CategoryOrmEntity, {
    onDelete: 'RESTRICT',
    nullable: false,
    createForeignKeyConstraints: true,
  })
  @JoinColumn({ name: 'category_id' })
  category?: CategoryOrmEntity;

  @Column({ type: 'int' })
  month: number;

  @Column({ type: 'int' })
  year: number;

  @Column({ name: 'amount_limit', type: 'int' })
  limit: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
