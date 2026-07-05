import { MonthPeriod } from '../../../../../shared/domain/month-period';
import {
  IReportsReadStore,
  PeriodTotals,
} from '../../../application/ports/reports-read-store.port';

export interface FakeMovement {
  userId: string;
  nature: 'income' | 'expense';
  amount: number;
  transactionDate: Date;
}

/**
 * Fake del read store para tests de use case (sin DB, sin TestingModule).
 *
 * Replica fielmente la semántica que importa: scoping por usuario y rango
 * half-open [start, end). Así los tests del use case verifican límites y
 * aislamiento de verdad, no contra un mock que devuelve lo que le digan.
 */
export class InMemoryReportsReadStore extends IReportsReadStore {
  private movements: FakeMovement[] = [];

  seed(movements: FakeMovement[]): void {
    this.movements.push(...movements);
  }

  getPeriodTotals(userId: string, period: MonthPeriod): Promise<PeriodTotals> {
    const inScope = this.movements.filter(
      (m) =>
        m.userId === userId &&
        m.transactionDate >= period.start &&
        m.transactionDate < period.end,
    );

    const sumBy = (nature: 'income' | 'expense'): number =>
      inScope
        .filter((m) => m.nature === nature)
        .reduce((acc, m) => acc + m.amount, 0);

    return Promise.resolve({
      income: sumBy('income'),
      expenses: sumBy('expense'),
    });
  }
}
