// DTO de respuesta — tipos planos, sin VOs ni ORM entities.
export class TransactionResponseDto {
  id: string;
  userId: string;
  accountId: string;
  categoryId: string;
  nature: string;
  amount: number;
  description: string | null;
  transactionDate: Date;
  createdAt: Date;
}
