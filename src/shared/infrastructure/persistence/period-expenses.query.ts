import { EntityManager } from 'typeorm';
import { monthPeriod } from '../../domain/month-period';

/**
 * ÚNICA implementación de "Σ gastos del período" contra `v_period_expenses`.
 *
 * Antes de este cierre (docs/history/structural-refactors.md, P6) esta sentencia existía dos veces,
 * carácter por carácter: `ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod`
 * (transactions) y `ScopedExpenseChecker.sumExpenseAmountInPeriod` (budgets). Ambas
 * la llaman ahora; los nombres de método en cada puerto no cambiaron porque
 * documentan la pregunta de cada consumidor, no la consulta.
 *
 * NO LOCK: lectura de agregado (SUM) — Postgres prohíbe FOR UPDATE sobre
 * agregados. La serialización la da el FOR UPDATE que el caller toma primero
 * sobre la fila de budget, en el MISMO `manager` (mismo QueryRunner → misma
 * transacción) que se pasa acá; esa garantía es responsabilidad de cada
 * caller, no de esta función.
 */
export async function sumPeriodExpenses(
  manager: EntityManager,
  userId: string,
  categoryId: string,
  month: number,
  year: number,
): Promise<number> {
  const { start, end } = monthPeriod(year, month);

  const raw = await manager
    .createQueryBuilder()
    .select('COALESCE(SUM(e.amount), 0)', 'total')
    .from('v_period_expenses', 'e')
    .where('e.user_id = :userId', { userId })
    .andWhere('e.category_id = :categoryId', { categoryId })
    .andWhere('e.transaction_date >= :start', { start })
    .andWhere('e.transaction_date < :end', { end })
    .getRawOne<{ total: string }>();

  return Number(raw?.total ?? 0);
}
