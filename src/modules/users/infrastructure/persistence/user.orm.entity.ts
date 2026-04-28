import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';

// `@Index({ unique: true })` en email es CRÍTICO:
//   1. Cierra race condition de "registrar dos veces el mismo email simultáneamente"
//      — sin esto, dos requests paralelas pueden pasar el check de GetUserByEmail y
//      ambas insertar. Postgres rechaza la segunda → UniqueViolation.
//   2. Acelera lookups por email (login, register) — es el query más común del módulo.
@Entity('users')
export class UserOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('uq_users_email', { unique: true })
  @Column()
  email: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ name: 'full_name' })
  name: string;

  // Plain @Column — NO usar @CreateDateColumn/@UpdateDateColumn.
  // TypeORM sobreescribiría las fechas en cada save(), ignorando lo que
  // el dominio computó. El dominio es dueño de sus timestamps.
  @Column({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'updated_at' })
  updatedAt: Date;
}
