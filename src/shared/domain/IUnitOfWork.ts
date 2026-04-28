/**
 * Generic Unit of Work — transactional boundary contract.
 *
 * Lives in `shared/domain` because transaction lifecycle (begin/commit/rollback/release)
 * is a cross-cutting concern: not owned by any single bounded context.
 *
 * Each module that needs to coordinate multiple repositories under a single DB
 * transaction defines its own port that EXTENDS this one and exposes the
 * repository getters relevant to its workflow (e.g. `ITransactionUnitOfWork`,
 * `IBudgetUnitOfWork`). The concrete implementation in infrastructure can
 * satisfy multiple of those module-specific ports with a single class —
 * NestJS binds them via `useExisting` so they share the same request-scoped
 * QueryRunner.
 */
export abstract class IUnitOfWork {
  abstract begin(): Promise<void>;
  abstract commit(): Promise<void>;
  abstract rollback(): Promise<void>;
  abstract release(): Promise<void>;
  abstract isActive(): boolean;
}
