import { IsInt, Min } from 'class-validator';

export class UpdateBudgetLimitDto {
  @IsInt()
  @Min(1)
  limit: number;
}
