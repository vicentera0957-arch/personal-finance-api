import { ApiProperty } from '@nestjs/swagger';

export class CategoryResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  userId: string;

  @ApiProperty({ example: 'Supermercado' })
  name: string;

  @ApiProperty({ example: 'expense', enum: ['income', 'expense'] })
  nature: string;

  @ApiProperty({ type: String, nullable: true, example: '#FF5733' })
  color: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'shopping-cart' })
  icon: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
