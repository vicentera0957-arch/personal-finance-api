import { Injectable } from '@nestjs/common';
import { IUserRepository } from '../../domain/repository/user.repository';
import { GetUserByIdUseCase } from './get-user-by-id.use-case';
import { User } from '../../domain/entities/user.entity';

interface UpdateUserProfileDto {
  id: string;
  name: string;
}

@Injectable()
export class UpdateUserProfileUseCase {
  constructor(
    // Recibe dos dependencias — el repositorio y otro use case
    private readonly userRepository: IUserRepository,
    private readonly getUserByIdUseCase: GetUserByIdUseCase,
  ) {}

  async execute(dto: UpdateUserProfileDto): Promise<User> {
    // Delega la búsqueda y verificación al use case que ya sabe hacerlo
    // Si el usuario no existe, GetUserByIdUseCase lanza UserNotFoundException
    const user = await this.getUserByIdUseCase.execute({ id: dto.id });

    // El método de negocio de la entidad valida y muta el estado internamente
    user.updateProfile(dto.name);

    // Persistir el estado actualizado
    return this.userRepository.save(user);
  }
}
