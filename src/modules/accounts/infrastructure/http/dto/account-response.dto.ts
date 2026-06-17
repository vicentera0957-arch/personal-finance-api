import { ApiProperty } from '@nestjs/swagger';

export class AccountResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  userId: string;

  @ApiProperty({ example: 'Cuenta Corriente Banco' })
  name: string;

  @ApiProperty({
    example: 'corriente',
    enum: ['ahorro', 'corriente', 'vista', 'ruta', 'otros'],
  })
  type: string;

  @ApiProperty({ example: 100000 })
  initialBalance: number;

  @ApiProperty({ example: 85000 })
  currentBalance: number;

  @ApiProperty({ example: false })
  isArchived: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
