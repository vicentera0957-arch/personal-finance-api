export class BudgetResponseDto {
  id: string;
  userId: string;
  categoryId: string;
  month: number;
  year: number;
  limit: number;
  createdAt: Date;
  updatedAt: Date;
}
