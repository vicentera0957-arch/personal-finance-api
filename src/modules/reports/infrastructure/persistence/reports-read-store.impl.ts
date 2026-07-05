import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MonthPeriod } from '../../../../shared/domain/month-period';
import {
  IReportsReadStore,
  PeriodTotals,
} from '../../application/ports/reports-read-store.port';

interface PeriodTotalsRow {
  income: string | null;
  expenses: string | null;
}

/**
 * Lee los totales del período con UNA sola sentencia SQL.
 *
 * ¿Por qué una sola sentencia? En READ COMMITTED (default de Postgres) el
 * snapshot MVCC es por-sentencia: las dos subqueries escalares (income y
 * expenses) ven el MISMO snapshot, así que son mutuamente consistentes sin
 * necesidad de abrir una transacción ni subir a REPEATABLE READ. Coherente con
 * "reports no toca el UoW, no toma locks".
 *
 * `expenses` sale de la view `v_period_expenses` — la definición única de gasto,
 * compartida con el enforcement de presupuestos. `income` queda inline porque
 * hoy tiene un solo consumidor (si aparece un segundo, se crea `v_period_incomes`
 * con el mismo patrón — YAGNI hasta entonces).
 *
 * Inyectar `DataSource` acá es legítimo: el anti-patrón de CLAUDE.md prohíbe
 * `DataSource` en USE CASES (para no saltarse los locks del write-side); esto es
 * infraestructura de lectura pura, sin locks que proteger. Precedente:
 * TypeOrmUnitOfWorkImpl también lo inyecta.
 */
@Injectable()
export class ReportsReadStoreImpl extends IReportsReadStore {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async getPeriodTotals(
    userId: string,
    period: MonthPeriod,
  ): Promise<PeriodTotals> {
    const rows = await this.dataSource.query<PeriodTotalsRow[]>(
      `SELECT
         (SELECT COALESCE(SUM(t.amount), 0)
            FROM transactions t
           WHERE t.user_id = $1
             AND t.nature = 'income'
             AND t.transaction_date >= $2
             AND t.transaction_date <  $3) AS income,
         (SELECT COALESCE(SUM(e.amount), 0)
            FROM v_period_expenses e
           WHERE e.user_id = $1
             AND e.transaction_date >= $2
             AND e.transaction_date <  $3) AS expenses`,
      [userId, period.start, period.end],
    );

    const row = rows[0];
    // pg devuelve SUM (bigint) como string; convertir en el borde. Montos en CLP
    // enteros < 2^53, así que Number no pierde precisión.
    return {
      income: Number(row?.income ?? 0),
      expenses: Number(row?.expenses ?? 0),
    };
  }
}
