import { Injectable } from '@nestjs/common';
import { IUserRepository } from '../../domain/repository/user.repository';
import { User } from '../../domain/entities/user.entity';
import { UserNotFoundException } from '../../domain/exceptions/user.exceptions';

interface GetUserByIdDto {
  id: string;
}

@Injectable()
export class GetUserByIdUseCase {
  constructor(private readonly userRepository: IUserRepository) {}
  async execute(dto: GetUserByIdDto): Promise<User> {
    const user = await this.userRepository.findById(dto.id);
    if (!user) {
      throw new UserNotFoundException(dto.id);
    }
    return user;
  }
}
