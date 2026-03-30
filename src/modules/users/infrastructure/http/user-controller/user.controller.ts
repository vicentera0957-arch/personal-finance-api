// users.controller.ts
import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
//use cases
import { CreateUserUseCase } from '../../../application/use-cases/create-user.use-case';
import { GetUserByIdUseCase } from '../../../application/use-cases/get-user-by-id.use-case';
import { UpdateUserProfileUseCase } from '../../../application/use-cases/update-user-profile.use-case';
import { DeleteUserUseCase } from '../../../application/use-cases/delete-user.use-case';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserProfileDto } from '../dto/update-user-profile.dto';
import { UserResponseDto } from '../dto/user-response.dto';
// Dominio
import { User } from '../../../domain/entities/user.entity';
import {
  UserNotFoundException,
  UserAlreadyExistsException,
  InvalidEmailFormatException,
  EmptyEmailException,
} from '../../../domain/exceptions/user.exceptions';

@Controller('users')
export class UsersController {
  constructor(
    //inyectamos los casos de uso necesarios para las operaciones del controlador
    private readonly createUserUseCase: CreateUserUseCase,
    private readonly getUserByIdUseCase: GetUserByIdUseCase,
    private readonly updateUserProfileUseCase: UpdateUserProfileUseCase,
    private readonly deleteUserUseCase: DeleteUserUseCase,
  ) {}

  // Convierte la entidad User a UserResponseDto
  // Método privado porque solo el controlador necesita hacer esta conversión
  private toResponse(user: User): UserResponseDto {
    // Se usa para validar la salida
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email.getValue();
    dto.name = user.getName();
    dto.createdAt = user.createdAt;
    dto.updatedAt = user.getUpdatedAt();
    return dto;
  }

  @Post()
  async create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    try {
      const user = await this.createUserUseCase.execute({
        // pide el objeto dto con los datos necesarios para crear el usuario, el use case se encarga de validar y manipular esos datos usando los value objects y la logica de negocio, y devuelve la entidad User creada, que el controlador convierte a UserResponseDto para devolver al cliente. El controlador no conoce la logica de negocio ni la implementacion concreta del repo ni del vo, solo conoce las interfaces y los DTOs.
        email: dto.email,
        password: dto.password,
        name: dto.name,
      });
      return this.toResponse(user);
    } catch (e) {
      if (e instanceof UserAlreadyExistsException) {
        throw new ConflictException(e.message); // 409
      }
      if (
        e instanceof InvalidEmailFormatException ||
        e instanceof EmptyEmailException
      ) {
        throw new BadRequestException(e.message); // 400
      }
      throw e;
    }
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<UserResponseDto> {
    try {
      const user = await this.getUserByIdUseCase.execute({ id });
      return this.toResponse(user);
    } catch (e) {
      if (e instanceof UserNotFoundException) {
        throw new NotFoundException(e.message); // 404
      }
      throw e;
    }
  }

  @Patch(':id/profile')
  async updateProfile(
    @Param('id') id: string,
    @Body() dto: UpdateUserProfileDto,
  ): Promise<UserResponseDto> {
    try {
      const user = await this.updateUserProfileUseCase.execute({
        id,
        name: dto.name,
      });
      return this.toResponse(user);
    } catch (e) {
      if (e instanceof UserNotFoundException) {
        throw new NotFoundException(e.message); // 404
      }
      throw e;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT) // 204 — delete exitoso no devuelve body
  async delete(@Param('id') id: string): Promise<void> {
    try {
      await this.deleteUserUseCase.execute({ id });
    } catch (e) {
      if (e instanceof UserNotFoundException) {
        throw new NotFoundException(e.message); // 404
      }
      throw e;
    }
  }
}
