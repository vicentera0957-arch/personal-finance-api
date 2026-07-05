import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Query del resumen mensual. `month` y `year` son OBLIGATORIOS (a diferencia de
 * get-budgets-query.dto.ts, donde son opcionales): un default "mes actual"
 * dependería de la TZ del servidor — la ambigüedad que está bajo investigación.
 *
 * Además, exigir el par acota el costo de la query por construcción: cada
 * consulta cubre a lo sumo un mes. Un rango libre `from/to` obligaría a validar
 * a mano la amplitud; acá la forma del parámetro impone la cota.
 *
 * Faltante o fuera de rango → 400 del ValidationPipe global, sin código extra.
 */
export class GetReportSummaryQueryDto {
  @ApiProperty({ example: 6, minimum: 1, maximum: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ example: 2026, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  year: number;
}
