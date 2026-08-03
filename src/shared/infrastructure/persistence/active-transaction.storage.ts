import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Marca de "ya hay una transacción abierta en esta cadena async".
 *
 * ⚠ REGLA: este store lleva SÓLO el nombre del dueño, para diagnóstico. NUNCA debe
 * llevar un EntityManager, un QueryRunner ni un repositorio. El contexto transaccional
 * se pasa EXPLÍCITAMENTE por el parámetro `ctx` de run(). Poner recursos acá convierte
 * este mecanismo en la propagación implícita que PROBLEMS.md:365-369 rechaza.
 */
export interface ActiveTransactionMark {
  readonly owner: string;
}

export const activeTransaction = new AsyncLocalStorage<ActiveTransactionMark>();
