import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @IsIn(['ahorro', 'corriente', 'vista', 'ruta', 'otros'])
  type: string;

  @IsInt()
  @Min(0)
  initialBalance: number;
}
