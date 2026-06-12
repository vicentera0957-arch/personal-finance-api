import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAccountDto {
  @ApiProperty({ example: 'Cuenta Corriente Banco', minLength: 2, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'corriente', enum: ['ahorro', 'corriente', 'vista', 'ruta', 'otros'] })
  @IsString()
  @IsIn(['ahorro', 'corriente', 'vista', 'ruta', 'otros'])
  type: string;

  @ApiProperty({ example: 100000, minimum: 0 })
  @IsInt()
  @Min(0)
  initialBalance: number;
}
