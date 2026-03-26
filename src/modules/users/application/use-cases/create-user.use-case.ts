import { Injectable } from '@nestjs/common';
import { IUserRepository } from '../../domain/repository/user.repository';
import { User } from '../../domain/entities/user.entity';
import { Email } from '../../domain/value-objects/email.vo';
import { UserAlreadyExistsException } from '../../domain/exceptions/user.exceptions';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

interface CreateUserDto {
  email: string;
  password: string;
  name: string;
}

@Injectable()
export class CreateUserUseCase {
  constructor(private readonly userRepository: IUserRepository) {}

  async execute(dto: CreateUserDto): Promise<User> {
    //Unico metodo del use case solo execute
    const email = Email.create(dto.email); // usa los metodos propios del vo

    const existing = await this.userRepository.findByEmail(email.getValue()); // usa la interfaz del repo para estos metodos, no importa la implementacion concreta del repo, solo la interfaz. La implemtancion concreta se encarga de traducir el email del vo a un string para la consulta a la db, pero el use case no tiene que preocuparse por eso, solo usa la interfaz del repo y el vo. Esto es lo que hace que el use case sea independiente de la implementacion concreta del repo y del vo, solo depende de las interfaces.
    if (existing) {
      throw new UserAlreadyExistsException(email.getValue());
    }

    const passwordHash = await bcrypt.hash(dto.password, 10); // despues haremos una interfaz de password hashing para no depender de bcrypt directamente, pero por ahora esta bien asi para simplificar

    const user = User.create({
      id: randomUUID(),
      email,
      passwordHash,
      name: dto.name,
    });

    return this.userRepository.save(user);
  }
}

// los use case en su mayoria usan los metodos de la interfaz del repo para acceder a los datos, y los metodos de los vo para validar y manipular los datos, pero no conocen la implementacion concreta de ninguno de los dos, solo las interfaces. Esto es lo que hace que el use case sea independiente de la implementacion concreta del repo y del vo, solo depende de las interfaces.
// podriamos definir a los use case como coordinadores de la logica de negocio, que usan los repositorios para acceder a los datos y los value objects para validar y manipular los datos, pero no conocen la implementacion concreta de ninguno de los dos, solo las interfaces. Esto es lo que hace que el use case sea independiente de la implementacion concreta del repo y del vo, solo depende de las interfaces.
