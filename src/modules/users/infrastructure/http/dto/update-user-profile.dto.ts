// src/modules/users/infrastructure/http/dto/update-user-profile.dto.ts
import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateUserProfileDto {
  @IsOptional() // si el campo no viene en el body, se ignora — no da error
  @IsString() // pero SI viene, tiene que ser string válido
  @MinLength(2) // y tiene que cumplir las mismas reglas que en CreateUserDto
  @MaxLength(100)
  name?: string; // el ? de TypeScript va de la mano con @IsOptional()
}
