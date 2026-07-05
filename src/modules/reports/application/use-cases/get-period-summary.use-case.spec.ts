import { GetPeriodSummaryUseCase } from './get-period-summary.use-case';
import { InMemoryReportsReadStore } from '../../infrastructure/persistence/__fakes__/in-memory-reports-read-store';

describe('GetPeriodSummaryUseCase', () => {
  let readStore: InMemoryReportsReadStore;
  let useCase: GetPeriodSummaryUseCase;

  beforeEach(() => {
    readStore = new InMemoryReportsReadStore();
    useCase = new GetPeriodSummaryUseCase(readStore);
  });

  it('computes net as income minus expenses', async () => {
    readStore.seed([
      {
        userId: 'u1',
        nature: 'income',
        amount: 1000,
        transactionDate: new Date(2026, 5, 10),
      },
      {
        userId: 'u1',
        nature: 'expense',
        amount: 300,
        transactionDate: new Date(2026, 5, 20),
      },
    ]);

    const result = await useCase.execute({
      userId: 'u1',
      month: 6,
      year: 2026,
    });

    expect(result).toEqual({
      month: 6,
      year: 2026,
      income: 1000,
      expenses: 300,
      net: 700,
    });
  });

  it('returns zeros for a period with no movements (no throw)', async () => {
    const result = await useCase.execute({
      userId: 'u1',
      month: 6,
      year: 2026,
    });

    expect(result).toEqual({
      month: 6,
      year: 2026,
      income: 0,
      expenses: 0,
      net: 0,
    });
  });

  it('produces a negative net when expenses exceed income', async () => {
    readStore.seed([
      {
        userId: 'u1',
        nature: 'income',
        amount: 100,
        transactionDate: new Date(2026, 5, 1),
      },
      {
        userId: 'u1',
        nature: 'expense',
        amount: 450,
        transactionDate: new Date(2026, 5, 2),
      },
    ]);

    const result = await useCase.execute({
      userId: 'u1',
      month: 6,
      year: 2026,
    });

    expect(result.net).toBe(-350);
  });

  it('includes the first instant of the month and excludes the first instant of the next month', async () => {
    readStore.seed([
      // Justo en el borde inferior [start → incluido.
      {
        userId: 'u1',
        nature: 'expense',
        amount: 10,
        transactionDate: new Date(2026, 5, 1, 0, 0, 0),
      },
      // Justo en el borde superior end) → excluido (pertenece a julio).
      {
        userId: 'u1',
        nature: 'expense',
        amount: 999,
        transactionDate: new Date(2026, 6, 1, 0, 0, 0),
      },
    ]);

    const result = await useCase.execute({
      userId: 'u1',
      month: 6,
      year: 2026,
    });

    expect(result.expenses).toBe(10);
  });

  it('handles December → January rollover', async () => {
    readStore.seed([
      {
        userId: 'u1',
        nature: 'income',
        amount: 500,
        transactionDate: new Date(2026, 11, 31),
      },
      // 1 de enero 2027 → fuera del período de diciembre.
      {
        userId: 'u1',
        nature: 'income',
        amount: 999,
        transactionDate: new Date(2027, 0, 1),
      },
    ]);

    const result = await useCase.execute({
      userId: 'u1',
      month: 12,
      year: 2026,
    });

    expect(result.income).toBe(500);
  });

  it('scopes totals to the requesting user only', async () => {
    readStore.seed([
      {
        userId: 'u1',
        nature: 'expense',
        amount: 100,
        transactionDate: new Date(2026, 5, 10),
      },
      {
        userId: 'u2',
        nature: 'expense',
        amount: 5000,
        transactionDate: new Date(2026, 5, 10),
      },
    ]);

    const result = await useCase.execute({
      userId: 'u1',
      month: 6,
      year: 2026,
    });

    expect(result.expenses).toBe(100);
  });

  it('passes month and year straight through to the result', async () => {
    const result = await useCase.execute({
      userId: 'u1',
      month: 3,
      year: 2025,
    });

    expect(result.month).toBe(3);
    expect(result.year).toBe(2025);
  });
});
