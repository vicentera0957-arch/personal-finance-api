import { Injectable } from '@nestjs/common';
import { IUserRepository } from '../../domain/repository/user.repository';
import { IUsersCache } from '../../domain/ports/cache/users-cache.port';
import { User } from '../../domain/entities/user.entity';
import { UserNotFoundException } from '../../domain/exceptions/user.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';

interface GetUserByIdDto {
  id: string;
  requestUserId: string;
}

@Injectable()
export class GetUserByIdUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly cache: IUsersCache,
  ) {}

  async execute(dto: GetUserByIdDto): Promise<User> {
    if (dto.id !== dto.requestUserId) {
      throw new ResourceOwnershipException(dto.id);
    }

    const cached = await this.cache.getById(dto.id);
    const user = cached ?? await this.userRepository.findById(dto.id);

    if (!user) throw new UserNotFoundException(dto.id);

    if (!cached) await this.cache.setById(user);
    return user;
  }
}
