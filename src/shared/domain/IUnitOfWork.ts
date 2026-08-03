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
 * `run<T>` is the ONLY method (closes P3 + P4): it opens the transaction,
 * builds the scoped-resource context (`TCtx`) exactly once, runs `work`,
 * and commits/rolls back/releases without the use case ever touching the
 * lifecycle by hand. The five manual methods that used to coexist with
 * `run()` during the module-by-module migration —
 * `begin`/`commit`/`rollback`/`release`/`isConnected` — are gone: every
 * impl now extends `TypeOrmTransactionRunner<TCtx>`
 * (shared/infrastructure/persistence/typeorm-transaction-runner.ts), which
 * owns that lifecycle in one place and keeps the `QueryRunner` on the call
 * stack of `run()` rather than in an instance field. No field, no request
 * scoping: every UoW provider is a plain singleton.
 */
export abstract class IUnitOfWork<TCtx> {
  abstract run<T>(work: (ctx: TCtx) => Promise<T>): Promise<T>;
}
