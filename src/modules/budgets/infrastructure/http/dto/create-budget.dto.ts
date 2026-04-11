import { IsInt, IsNotEmpty, IsUUID, Max, Min } from 'class-validator';

export class CreateBudgetDto {
  @IsUUID()
  @IsNotEmpty()
  categoryId: string;

  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsInt()
  @Min(1)
  year: number;

  @IsInt()
  @Min(1)
  limit: number;
}
