/**
 * Rango temporal half-open [start, end) de un mes calendario.
 * `start` = primer instante del mes; `end` = primer instante del mes siguiente.
 * Half-open evita el doble conteo del último día que tendría un rango cerrado.
 */
export interface MonthPeriod {
  start: Date;
  end: Date;
}

/**
 * Fuente ÚNICA de la semántica de "límites de un período mensual".
 *
 * Antes esta lógica estaba duplicada como `new Date(year, month - 1, 1)` en los
 * tres agregados de enforcement del UoW de transacciones. Centralizarla acá deja
 * un solo lugar donde arreglar la semántica de timezone cuando se resuelva la
 * investigación pendiente (hoy `new Date(year, month, day)` interpreta los
 * límites en la TZ local del servidor; `transaction_date` es TIMESTAMP sin TZ).
 *
 * OJO: esta función es una COPIA EXACTA de la semántica que ya existía — no
 * cambia el comportamiento actual, sólo lo unifica. No resolver la TZ aquí.
 *
 * @param month 1-12 (enero = 1). No se valida: la validación de rango vive en
 *              los DTOs / value objects que llaman a esta función.
 */
export function monthPeriod(year: number, month: number): MonthPeriod {
  return {
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 1),
  };
}
