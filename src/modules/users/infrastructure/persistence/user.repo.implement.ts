import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { IUserRepository } from '../../domain/repository/user.repository';
import { User } from '../../domain/entities/user.entity';
import { UserOrmEntity } from './user.orm.entity';
import { UserMapper } from './user.mapper';
import { UserAlreadyExistsException } from '../../domain/exceptions/user.exceptions';

@Injectable()
export class UserRepositoryImpl extends IUserRepository {
  constructor(
    // @InjectRepository le dice a NestJS qué repositorio de TypeORM inyectar
    // sin este decorador NestJS no sabe qué tabla quieres
    @InjectRepository(UserOrmEntity)
    private readonly ormRepository: Repository<UserOrmEntity>,

    // El mapper llega por DI — no lo instanciamos nosotros
    private readonly mapper: UserMapper,
  ) {
    super();
  }

  async findById(id: string): Promise<User | null> {
    const orm = await this.ormRepository.findOne({ where: { id } });

    // Si TypeORM no encuentra nada devuelve null
    // El repositorio no decide si eso es un error — esa decisión le pertenece al use case
    if (!orm) return null;

    // Convertimos de ORM entity a dominio antes de devolver
    return this.mapper.toDomain(orm);
  }

  async findByEmail(email: string): Promise<User | null> {
    const orm = await this.ormRepository.findOne({ where: { email } });

    if (!orm) return null;

    return this.mapper.toDomain(orm);
  }

  async save(user: User): Promise<User> {
    // Convertimos de dominio a ORM entity antes de persistir
    const orm = this.mapper.toOrm(user);

    try {
      // TypeORM decide internamente si hace INSERT o UPDATE
      // basándose en si el id ya existe en la tabla
      const saved = await this.ormRepository.save(orm);

      // Devolvemos el resultado convertido de vuelta al dominio
      return this.mapper.toDomain(saved);
    } catch (err) {
      // Cierra Bug E: dos concurrent POST /auth/register con el mismo email
      // — la segunda falla con constraint violation (23505 en Postgres).
      // Sin este catch, TypeORM propaga QueryFailedError → NestJS devuelve 500.
      // Con esto, mapeamos a domain exception → controller mapea a 409.
      if (
        err instanceof QueryFailedError &&
        (err as QueryFailedError & { driverError?: { code?: string } })
          .driverError?.code === '23505'
      ) {
        throw new UserAlreadyExistsException(user.email.getValue());
      }
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    // delete no necesita el mapper — solo necesita el id
    await this.ormRepository.delete(id);
  }
}
