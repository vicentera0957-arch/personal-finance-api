import { ApiProperty } from '@nestjs/swagger';

export class ReportSummaryResponseDto {
  @ApiProperty({ example: 6, description: 'Mes del período (1-12)' })
  month: number;

  @ApiProperty({ example: 2026, description: 'Año del período' })
  year: number;

  @ApiProperty({
    example: 1200000,
    description: 'Total de ingresos del período (CLP)',
  })
  income: number;

  @ApiProperty({
    example: 850000,
    description: 'Total de gastos del período (CLP)',
  })
  expenses: number;

  @ApiProperty({
    example: 350000,
    description: 'income - expenses; puede ser negativo',
  })
  net: number;
}
