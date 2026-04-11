import { Injectable } from '@nestjs/common';
import { IUserRepository } from '../../domain/repository/user.repository';
import { User } from '../../domain/entities/user.entity';
import { UserNotFoundException } from '../../domain/exceptions/user.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

interface GetUserByIdDto {
  id: string;
  requestUserId: string;
}

@Injectable()
export class GetUserByIdUseCase {
  constructor(private readonly userRepository: IUserRepository) {}
  async execute(dto: GetUserByIdDto): Promise<User> {
    if (dto.id !== dto.requestUserId) {
      throw new ResourceOwnershipException(dto.id);
    }
    const user = await this.userRepository.findById(dto.id);
    if (!user) {
      throw new UserNotFoundException(dto.id);
    }
    return user;
  }
}
