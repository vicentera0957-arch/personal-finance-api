import { ApiProperty } from '@nestjs/swagger';

export class TransactionResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  userId: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  accountId: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  categoryId: string;

  @ApiProperty({ example: 'expense', enum: ['income', 'expense'] })
  nature: string;

  @ApiProperty({ example: 15000 })
  amount: number;

  @ApiProperty({ type: String, nullable: true, example: 'Almuerzo de trabajo' })
  description: string | null;

  @ApiProperty({ example: '2026-06-12T00:00:00.000Z' })
  transactionDate: Date;

  @ApiProperty()
  createdAt: Date;
}
