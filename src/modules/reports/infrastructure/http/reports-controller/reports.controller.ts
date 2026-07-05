import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';
import {
  GetPeriodSummaryUseCase,
  PeriodSummary,
} from '../../../application/use-cases/get-period-summary.use-case';
import { GetReportSummaryQueryDto } from '../dto/get-report-summary-query.dto';
import { ReportSummaryResponseDto } from '../dto/report-summary-response.dto';

@ApiTags('reports')
@ApiBearerAuth('access-token')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly getPeriodSummaryUseCase: GetPeriodSummaryUseCase,
  ) {}

  private toResponse(summary: PeriodSummary): ReportSummaryResponseDto {
    const dto = new ReportSummaryResponseDto();
    dto.month = summary.month;
    dto.year = summary.year;
    dto.income = summary.income;
    dto.expenses = summary.expenses;
    dto.net = summary.net;
    return dto;
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Resumen financiero del mes (ingresos, gastos y neto)',
  })
  @ApiResponse({
    status: 200,
    description: 'Resumen del período (ceros si no hay movimientos)',
    type: ReportSummaryResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'month/year faltantes o fuera de rango',
  })
  // Sin try/catch: el use case no lanza excepciones de dominio. Un período vacío
  // es un resultado válido (ceros, 200), no un error. Por eso la tabla
  // excepción→HTTP de CLAUDE.md no incorpora ninguna fila nueva.
  async getSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetReportSummaryQueryDto,
  ): Promise<ReportSummaryResponseDto> {
    const summary = await this.getPeriodSummaryUseCase.execute({
      userId: user.userId,
      month: query.month,
      year: query.year,
    });
    return this.toResponse(summary);
  }
}
