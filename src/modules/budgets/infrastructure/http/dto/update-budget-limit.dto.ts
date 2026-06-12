import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateBudgetLimitDto {
  @ApiProperty({ example: 600000, minimum: 1 })
  @IsInt()
  @Min(1)
  limit: number;
}
