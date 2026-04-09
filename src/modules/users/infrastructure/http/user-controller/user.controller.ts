// users.controller.ts
import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
//use cases
import { GetUserByIdUseCase } from '../../../application/use-cases/get-user-by-id.use-case';
import { UpdateUserProfileUseCase } from '../../../application/use-cases/update-user-profile.use-case';
import { DeleteUserUseCase } from '../../../application/use-cases/delete-user.use-case';
import { UpdateUserProfileDto } from '../dto/update-user-profile.dto';
import { UserResponseDto } from '../dto/user-response.dto';
// Dominio
import { User } from '../../../domain/entities/user.entity';
import {
  UserNotFoundException,
  InvalidNameException,
} from '../../../domain/exceptions/user.exceptions';

@Controller('users')
export class UsersController {
  constructor(
    private readonly getUserByIdUseCase: GetUserByIdUseCase,
    private readonly updateUserProfileUseCase: UpdateUserProfileUseCase,
    private readonly deleteUserUseCase: DeleteUserUseCase,
  ) {}

  private toResponse(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email.getValue();
    dto.name = user.getName();
    dto.createdAt = user.createdAt;
    dto.updatedAt = user.getUpdatedAt();
    return dto;
  }

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponseDto> {
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
    @Param('id', ParseUUIDPipe) id: string,
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
      if (e instanceof InvalidNameException) {
        throw new BadRequestException(e.message); // 400
      }
      throw e;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT) // 204 — delete exitoso no devuelve body
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
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
