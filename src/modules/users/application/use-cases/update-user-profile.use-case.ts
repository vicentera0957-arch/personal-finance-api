import { Injectable } from '@nestjs/common';
import { IUserRepository } from '../../domain/repository/user.repository';
import { IUsersCache } from '../../domain/ports/cache/users-cache.port';
import { GetUserByIdUseCase } from './get-user-by-id.use-case';
import { User } from '../../domain/entities/user.entity';

interface UpdateUserProfileDto {
  id: string;
  name?: string;
  requestUserId: string;
}

@Injectable()
export class UpdateUserProfileUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly getUserByIdUseCase: GetUserByIdUseCase,
    private readonly cache: IUsersCache,
  ) {}

  async execute(dto: UpdateUserProfileDto): Promise<User> {
    const user = await this.getUserByIdUseCase.execute({
      id: dto.id,
      requestUserId: dto.requestUserId,
    });

    if (dto.name !== undefined) user.updateProfile(dto.name);

    const saved = await this.userRepository.save(user);
    await this.cache.invalidateById(saved.id);
    return saved;
  }
}
