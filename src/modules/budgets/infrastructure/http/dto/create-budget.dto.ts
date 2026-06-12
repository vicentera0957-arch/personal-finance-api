import { IsInt, IsNotEmpty, IsUUID, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBudgetDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  @IsUUID()
  @IsNotEmpty()
  categoryId: string;

  @ApiProperty({ example: 6, minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ example: 2026, minimum: 1 })
  @IsInt()
  @Min(1)
  year: number;

  @ApiProperty({ example: 500000, minimum: 1 })
  @IsInt()
  @Min(1)
  limit: number;
}
