import { Injectable } from '@nestjs/common';
import { monthPeriod } from '../../../../shared/domain/month-period';
import { IReportsReadStore } from '../ports/reports-read-store.port';

export interface GetPeriodSummaryQuery {
  userId: string;
  month: number;
  year: number;
}

export interface PeriodSummary {
  month: number;
  year: number;
  income: number;
  expenses: number;
  net: number;
}

/**
 * Resumen financiero de un mes: income, expenses y net del usuario.
 *
 * No lanza excepciones de dominio: un mes sin movimientos es un resultado
 * válido (ceros), no un recurso inexistente. Por eso el controller no mapea
 * nada y la tabla excepción→HTTP de CLAUDE.md no cambia.
 *
 * Derivar el período (month/year → rango de fechas) es lógica de aplicación, así
 * que ocurre acá; el read store recibe fechas ya calculadas y queda "tonto".
 */
@Injectable()
export class GetPeriodSummaryUseCase {
  constructor(private readonly readStore: IReportsReadStore) {}

  async execute(query: GetPeriodSummaryQuery): Promise<PeriodSummary> {
    const period = monthPeriod(query.year, query.month);
    const { income, expenses } = await this.readStore.getPeriodTotals(
      query.userId,
      period,
    );

    return {
      month: query.month,
      year: query.year,
      income,
      expenses,
      net: income - expenses,
    };
  }
}
