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
    const email = Email.create(dto.email);

    // Verifica unicidad del email
    const existing = await this.userRepository.findByEmail(email.getValue());
    if (existing) {
      throw new UserAlreadyExistsException(email.getValue());
    }

    // TODO(tech-debt): abstraer bcrypt con IPasswordHasher
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = User.create({
      id: randomUUID(),
      email,
      passwordHash,
      name: dto.name,
    });

    return this.userRepository.save(user);
  }
}
