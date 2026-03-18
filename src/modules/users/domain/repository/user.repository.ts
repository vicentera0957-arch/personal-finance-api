// src/modules/users/domain/repositories/user.repository.ts

import { User } from '../entities/user.entity';

// abstract class en lugar de interface por una razón específica de NestJS:
// TypeScript borra las interfaces en compilación. NestJS necesita
// un token real en runtime para la inyección de dependencias.
// Con abstract class ese token existe. Con interface, no.

export abstract class IUserRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract findByEmail(email: string): Promise<User | null>;
  abstract save(user: User): Promise<User>;
  abstract delete(id: string): Promise<void>;
}
