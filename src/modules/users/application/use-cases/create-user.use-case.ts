import { Injectable } from '@nestjs/common';
import { IUserRepository } from '../../domain/repository/user.repository';
import { User } from '../../domain/entities/user.entity';
import { Email } from '../../domain/value-objects/email.vo';
import { UserAlreadyExistsException } from '../../domain/exceptions/user.exceptions';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

// El DTO de entrada — describe qué datos necesita este use case
// Es distinto al DTO HTTP del controlador, este no sabe que existe una red
interface CreateUserDto {
  email: string;
  password: string;
  name: string;
}

@Injectable() // se registra en el sistema DI de nest
export class CreateUserUseCase {
  // Las dependencias llegan por DI — el use case no las instancia
  constructor(private readonly userRepository: IUserRepository) {} // siempre el DI tiene esta forma

  async execute(dto: CreateUserDto): Promise<User> {
    // Paso 1: construir el VO — si el email tiene formato inválido
    // lanza excepción aquí, antes de tocar la base de datos
    // Usamos metodos del VO.
    const email = Email.create(dto.email);

    // Paso 2: verificar que el email no esté en uso
    // Solo el use case puede hacer esto — necesita el repositorio

    // Hacemos uso de los metodos que creamos en el repo y en las excepciones, el use case no sabe cómo se implementan, solo que existen y qué hacen.
    const existing = await this.userRepository.findByEmail(email.getValue());
    if (existing) {
      throw new UserAlreadyExistsException(email.getValue());
    }

    // Paso 3: hashear el password — bcrypt es una dependencia técnica
    // la entidad no sabe que existe bcrypt, solo recibe el hash resultante
    // Se hara posteriormente una interface para el hashing para desacoplar del usecase
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Paso 4: crear la entidad con todos los datos ya procesados
    // User.create() genera createdAt y updatedAt internamente
    const user = User.create({
      id: uuidv4(),
      email,
      passwordHash,
      name: dto.name,
    });

    // Paso 5: persistir y retornar
    // el use case no sabe si esto usa TypeORM, Prisma, o memoria
    return this.userRepository.save(user);
  }
}
