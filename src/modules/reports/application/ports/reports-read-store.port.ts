import { MonthPeriod } from '../../../../shared/domain/month-period';

/** Totales crudos de un período, tal como los agrega la base de datos. */
export interface PeriodTotals {
  income: number;
  expenses: number;
}

/**
 * Puerto de lectura del módulo reports.
 *
 * Vive en `application/` (no en `domain/`) porque reports es un read model sin
 * capa de dominio: no protege invariantes, no reconstituye entidades. El dueño
 * del contrato es el use case, así que el puerto vive junto a él (dependency
 * inversion: application define, infrastructure implementa).
 *
 * Es `abstract class` y no `interface` por la convención de DI del repo: una
 * interface de TS se borra en compilación y no puede ser token de inyección.
 */
export abstract class IReportsReadStore {
  /**
   * Suma income y expenses del usuario dentro del período [start, end).
   * Un período sin movimientos devuelve ceros (no lanza).
   */
  abstract getPeriodTotals(
    userId: string,
    period: MonthPeriod,
  ): Promise<PeriodTotals>;
}
