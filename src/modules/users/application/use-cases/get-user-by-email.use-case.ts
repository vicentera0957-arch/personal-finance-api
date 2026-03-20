import { Injectable } from '@nestjs/common';
import { IUserRepository } from '../../domain/repository/user.repository';
import { User } from '../../domain/entities/user.entity';
import { UserNotFoundException } from '../../domain/exceptions/user.exceptions';
import { Email } from '../../domain/value-objects/email.vo';
interface GetUserByEmailDto {
  email: string;
}

@Injectable()
export class GetUserByEmailUseCase {
  constructor(private readonly userRepository: IUserRepository) {}

  async execute(dto: GetUserByEmailDto): Promise<User> {
    const email = Email.create(dto.email); // creado en runtime, si el email es inválido lanza excepción aquí
    const user = await this.userRepository.findByEmail(email.getValue()); //busca en db
    if (!user) {
      throw new UserNotFoundException(
        `User with email ${email.getValue()} not found`,
      );
    }
    return user;
  }
}
