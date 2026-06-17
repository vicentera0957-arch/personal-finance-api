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
    //getUserById gestiona excepciones de usuario no encontrado y ownership, así que lo reutilizamos.
    const user = await this.getUserByIdUseCase.execute({
      id: dto.id,
      requestUserId: dto.requestUserId,
    });
    //name es el único campo que se puede actualizar en este caso, pero si viniera undefined no hacemos nada.
    if (dto.name !== undefined) user.updateProfile(dto.name);
    //no hariamos una llamada a la db con aunque no se haya proporcionado nigun campo a editar (name)??
    const saved = await this.userRepository.save(user);

    //Invalidamos el usuario en cache por el update.
    await this.cache.invalidateById(saved.id);
    return saved;
  }
}
