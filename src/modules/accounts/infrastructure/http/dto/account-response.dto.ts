export class AccountResponseDto {
  id: string;
  userId: string;
  name: string;
  type: string;
  initialBalance: number;
  currentBalance: number;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}
