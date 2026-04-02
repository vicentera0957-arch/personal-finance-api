import { Injectable } from '@nestjs/common';
import { UserOrmEntity } from '../persistence/user.orm.entity';
import { User } from '../../domain/entities/user.entity';
import { Email } from '../../domain/value-objects/email.vo';

@Injectable() //usamos di para inyectar este mapper en el repositorio, reduciendo desacomplamiento
export class UserMapper {
  // no usamos metodos estaticos, es importante instanciar la clase para usar DI.
  toDomain(orm: UserOrmEntity): User {
    const email = Email.create(orm.email);

    return User.reconstitute({
      id: orm.id,
      email,
      passwordHash: orm.passwordHash,
      name: orm.name,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }

  toOrm(domain: User): UserOrmEntity {
    const orm = new UserOrmEntity();

    orm.id = domain.id;
    orm.email = domain.email.getValue();
    orm.passwordHash = domain.getPasswordHash();
    orm.name = domain.getName();
    orm.createdAt = domain.createdAt;
    orm.updatedAt = domain.getUpdatedAt();

    return orm;
  }
}
// Los mappers no contienen logica, solo son transformadores de datos entre capas
