import { Injectable } from '@nestjs/common';
import { IUserRepository } from '../../domain/repository/user.repository';
import { GetUserByIdUseCase } from './get-user-by-id.use-case';
import { User } from '../../domain/entities/user.entity';

interface UpdateUserProfileDto {
  id: string;
  name?: string;
}

//Por ahora el metodo no tiene mucho sentido pq solo se actualiza un solo parametro(el nombre), y ademas se deja opcional
// Me interesa mas que nada dejar la logica mas o menos lista para luego si tengo que agregar mas campos a actualizar, no tener que cambiar la logica del caso de uso, solo agregar los nuevos campos a la interfaz y a la entidad, y el caso de uso seguiria funcionando sin cambios
@Injectable()
export class UpdateUserProfileUseCase {
  constructor(
    // Recibe dos dependencias — el repositorio y otro use case
    private readonly userRepository: IUserRepository,
    private readonly getUserByIdUseCase: GetUserByIdUseCase,
  ) {}

  async execute(dto: UpdateUserProfileDto): Promise<User> { //hacemos la interfaz de entrada más específica para este caso de uso
    // Delega la búsqueda y verificación al use case que ya sabe hacerlo
    // Si el usuario no existe, GetUserByIdUseCase lanza UserNotFoundException, dependemos de otro use case para manejar esa lógica, no la repetimos aquí
    const user = await this.getUserByIdUseCase.execute({ id: dto.id }); // esto cuenta con la excepcion de forma interna asi que no hay que manejarla aqui

    // El método de negocio de la entidad valida y muta el estado internamente
    if (dto.name !== undefined) { //consultamos si el nombre fue proporcionado, si no se proporciona, no lo actualizamos, esto permite que el caso de uso sea flexible y solo actualice lo que se le indique
      user.updateProfile(dto.name);
    }
    // Persistir el estado actualizado
    return this.userRepository.save(user); 
  }
}
