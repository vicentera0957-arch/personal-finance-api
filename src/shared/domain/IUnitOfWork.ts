/**
 * Generic Unit of Work — transactional boundary contract.
 *
 * Lives in `shared/domain` because transaction lifecycle is a cross-cutting
 * concern: not owned by any single bounded context.
 *
 * `TCtx` is the set of scoped resources the module exposes inside the
 * transaction. It is a structural type (not a DI token), so it can be an
 * `interface` — same category as the `XCommand` types on the use cases
 * (`create-transaction.use-case.ts`, `update-budget-limit.use-case.ts`).
 * `TCtx` is never injected: it is only ever the type of `run()`'s callback
 * parameter, so this does not violate the "ports are `abstract class`"
 * rule — that rule exists because DI tokens must survive erasure, and
 * `TCtx` is never a token.
 *
 * `run<T>` is the stateless runner (closes P3 + P4): it opens the
 * transaction, builds the scoped-resource context (`TCtx`) exactly once,
 * runs `work`, and commits/rolls back/releases without the use case ever
 * touching the lifecycle by hand. It coexists with the five manual methods
 * below (`begin`/`commit`/`rollback`/`release`/`isConnected`) for the
 * duration of the module-by-module migration — each impl still implements
 * them and `run()` reuses them internally. The five disappear once every
 * use case has moved off them.
 */
export abstract class IUnitOfWork<TCtx> {
  abstract begin(): Promise<void>;
  abstract commit(): Promise<void>;
  abstract rollback(): Promise<void>;
  abstract release(): Promise<void>;
  /**
   * ¿Hay una conexión reservada? True entre begin() y release(), INCLUIDO
   * después del commit. Para saber si hay transacción abierta es
   * `queryRunner.isTransactionActive`.
   */
  abstract isConnected(): boolean;
  abstract run<T>(work: (ctx: TCtx) => Promise<T>): Promise<T>;
}
