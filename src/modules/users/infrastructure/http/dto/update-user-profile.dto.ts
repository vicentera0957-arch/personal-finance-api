import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserProfileDto extends PartialType(CreateUserDto) {
  // Para esta petición solo se usa name, pero se hereda la validación opcional
  // de CreateUserDto sobre name.
}
