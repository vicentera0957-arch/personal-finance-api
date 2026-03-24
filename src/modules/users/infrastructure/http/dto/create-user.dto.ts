import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail() // verifica formato de email (no solo que sea string)
  @IsNotEmpty() // rechaza string vacío ""
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8) // regla de negocio mínima: contraseñas cortas son inseguras
  @MaxLength(100) // evitás ataques con payloads enormes
  password: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2) // "A" no es un nombre válido
  @MaxLength(100)
  name: string;
}
