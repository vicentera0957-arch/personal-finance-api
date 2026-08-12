/**
 * Se lanza cuando una cadena async intenta abrir una segunda transacción
 * mientras la primera sigue activa — el auto-deadlock que el runner sin
 * estado habilita (ver `typeorm-transaction-runner.ts` y el análisis en
 * `docs/history/structural-refactors.md`, P3+P4 (§5 del plan archivado)).
 *
 * Nombra al dueño externo (la transacción ya abierta) y al interno (la que
 * intentó abrirse encima) para que el mensaje señale la causa sin tener que
 * inspeccionar el stack.
 */
export class NestedTransactionError extends Error {
  constructor(outerOwner: string, innerOwner: string) {
    super(
      `Nested transaction detected: "${innerOwner}" tried to open a new ` +
        `transaction while "${outerOwner}" already has one active in this ` +
        `async chain. A use case may inject at most one UoW port; if it needs ` +
        `to coordinate two aggregates, compose their scoped resources inside a ` +
        `single run() call instead of nesting uow.run() calls.`,
    );
    this.name = 'NestedTransactionError';
  }
}
