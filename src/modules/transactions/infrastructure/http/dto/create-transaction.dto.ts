import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTransactionDto {
  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsUUID()
  @IsNotEmpty()
  accountId: string;

  @IsUUID()
  @IsNotEmpty()
  categoryId: string;

  // Solo acepta los valores del VO TransactionNature
  @IsIn(['income', 'expense'])
  nature: string;

  // Monto positivo en CLP — el VO Amount refuerza amount > 0
  @IsInt()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  // ISO 8601 string — el frontend envía la fecha real del movimiento
  @IsDateString()
  @Type(() => Date)
  transactionDate: Date;
}
