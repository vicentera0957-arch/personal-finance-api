import { Injectable } from '@nestjs/common';
import { IUserRepository } from '../../domain/repository/user.repository';
import { GetUserByIdUseCase } from './get-user-by-id.use-case';
import { User } from '../../domain/entities/user.entity';

interface UpdateUserProfileDto {
  id: string;
  name?: string;
  requestUserId: string;
}

// Actualiza campos editables del perfil (por ahora solo name)
@Injectable()
export class UpdateUserProfileUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly getUserByIdUseCase: GetUserByIdUseCase,
  ) {}

  async execute(dto: UpdateUserProfileDto): Promise<User> {
    // Delega búsqueda a GetUserByIdUseCase (lanza si no existe)
    const user = await this.getUserByIdUseCase.execute({
      id: dto.id,
      requestUserId: dto.requestUserId,
    });

    if (dto.name !== undefined) {
      user.updateProfile(dto.name);
    }

    return this.userRepository.save(user);
  }
}
