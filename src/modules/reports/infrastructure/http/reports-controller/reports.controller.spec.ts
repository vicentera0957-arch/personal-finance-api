import { ReportsController } from './reports.controller';
import {
  GetPeriodSummaryUseCase,
  PeriodSummary,
} from '../../../application/use-cases/get-period-summary.use-case';
import { GetReportSummaryQueryDto } from '../dto/get-report-summary-query.dto';
import type { AuthenticatedUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';

describe('ReportsController', () => {
  let controller: ReportsController;
  let getSummaryUseCase: jest.Mocked<GetPeriodSummaryUseCase>;

  const currentUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'a@b.cl',
  };

  const query = (month: number, year: number): GetReportSummaryQueryDto => {
    const dto = new GetReportSummaryQueryDto();
    dto.month = month;
    dto.year = year;
    return dto;
  };

  beforeEach(() => {
    getSummaryUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetPeriodSummaryUseCase>;

    controller = new ReportsController(getSummaryUseCase);
  });

  it('takes userId from the current user, never from the query', async () => {
    const summary: PeriodSummary = {
      month: 6,
      year: 2026,
      income: 1000,
      expenses: 300,
      net: 700,
    };
    getSummaryUseCase.execute.mockResolvedValue(summary);

    await controller.getSummary(currentUser, query(6, 2026));

    expect(getSummaryUseCase.execute).toHaveBeenCalledWith({
      userId: 'user-1',
      month: 6,
      year: 2026,
    });
  });

  it('maps the use case result field-by-field to the response DTO', async () => {
    const summary: PeriodSummary = {
      month: 6,
      year: 2026,
      income: 1000,
      expenses: 300,
      net: 700,
    };
    getSummaryUseCase.execute.mockResolvedValue(summary);

    const result = await controller.getSummary(currentUser, query(6, 2026));

    expect(result).toEqual({
      month: 6,
      year: 2026,
      income: 1000,
      expenses: 300,
      net: 700,
    });
  });
});
