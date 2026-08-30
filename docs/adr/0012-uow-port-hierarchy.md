# ADR-0012: A three-level Unit of Work port hierarchy, one impl per transactional boundary

- **Status:** Accepted
- **Date:** 2026-06-20 · revised 2026-08-06 (P3–P5) · recorded as an ADR 2026-08-30
- **Deciders:** Vicente Cristobal Rivas Avello

> [ADR-0002](./0002-unit-of-work-pessimistic-locks.md) settles **why** there is a Unit of
> Work at all (pessimistic row locks over `SERIALIZABLE`). This ADR settles the **shape**
> of the ports around it: how many there are, who owns each, and which module implements
> them. The full reference lives in
> [`src/shared/domain/uow-decision.md`](../../src/shared/domain/uow-decision.md).

## Context and problem statement

`CreateTransaction` writes a transaction row, adjusts an account balance and checks a
budget limit — three aggregates, three modules, one atomic operation. Something has to
hand a use case a set of repositories that all share one `QueryRunner`, so that the
`FOR UPDATE` locks taken through them actually protect the invariant.

The obvious shapes all fail:

- **One global `IUnitOfWork` exposing every repository.** Every use case sees every
  repository in the system; the transactional context of `auth` includes `budgets`.
- **A UoW port per module, each implemented by whichever module happens to need it.**
  This is what the codebase actually did, and it is how `accounts ⇄ transactions` and
  later `budgets ⇄ transactions` became import cycles held together by `forwardRef()`
  ([`history/structural-refactors.md`](../history/structural-refactors.md), P1/P2).
- **A stateful UoW** (`begin`/`commit`/`rollback`/`release` + a mutable `QueryRunner`
  field). The field leaks across requests unless every provider is `Scope.REQUEST`, which
  is a performance tax paid to protect a field that need not exist.

## Decision

We will structure the Unit of Work as **three levels**, and bind **one implementation per
transactional boundary**:

**Level 1 — the generic contract.** `IUnitOfWork<TCtx>`
(`shared/domain/IUnitOfWork.ts`) declares exactly one method:

```ts
export abstract class IUnitOfWork<TCtx> {
  abstract run<T>(work: (ctx: TCtx) => Promise<T>): Promise<T>;
}
```

It knows nothing about repositories — `TCtx` is a type parameter. The lifecycle
(connect → begin → `work(ctx)` → commit/rollback → release) lives in exactly one class,
`TypeOrmTransactionRunner`, with the `QueryRunner` on the call stack of `run()` rather
than in a field. Every provider is a plain singleton.

**Level 2 — a port per module that needs atomicity.** `I<Module>UnitOfWork extends
IUnitOfWork<TCtx>` and declares **no members of its own**; the module-specific surface
lives entirely in its `TCtx`, a plain structural interface listing the scoped
repositories that module's flows need — **including repositories owned by other
modules**. `TCtx` lives in the consuming module's `domain/`
([ADR-0003](./0003-port-owned-by-consumer.md), as corrected by
[ADR-0009](./0009-scoped-repositories-as-guarded-factories.md)).

Each entry of a `TCtx` is narrowed to what that consumer actually needs — a **sibling**
port, never a subtype (extending would drag `save`/`delete` along):

| `TransactionTxContext` property | Port | Surface |
| --- | --- | --- |
| `transactions` | `IScopedTransactionRepository` | own aggregate, full |
| `accounts` | `IScopedAccountRepository` | `findByIdWithLock` + `save` — the balance write it owns |
| `budgetPeriodReader` | `IScopedBudgetPeriodReader` | read-only; transactions never writes a budget |

**Level 3 — one impl per boundary, owned by the module that owns the aggregate.** Four
ports, four impls, 1:1: `TypeOrmUnitOfWorkImpl` (transactions), `BudgetUnitOfWorkImpl`,
`AccountUnitOfWorkImpl`, `AuthUnitOfWorkImpl`. **A module never declares a provider for
another module's UoW token.**

## Why this option

**Because the dependency that creates a cycle is the provider, not the import.** A module
that declares `{ provide: IOtherUnitOfWork, useExisting: MyImpl }` has to import the other
module to name the token, and the other module imports it back to consume the impl. Both
cycles in this codebase had exactly that shape. Making impl ownership follow aggregate
ownership removes the reason to name a foreign token at all — the module graph has **zero
`forwardRef()` calls** today, and that is the load-bearing consequence.

**Because `run()` is universal and `TCtx` is not.** This is the split that makes
inheritance the right tool here, where it is the wrong tool for the cache
([ADR-0011](./0011-cache-strategy.md)): the use case *must* call the shared port's method
— `uow.run(...)` is the whole API — so exposing it is the point. The module contributes a
type parameter, not new methods. `IBudgetUnitOfWork extends IUnitOfWork<BudgetTxContext>`
specializes without replacing; `IBudgetsCache` would not.

**Because the callback shape makes the lifecycle unreachable.** With `run()` as the only
method there is no `commit()` for a use case to forget, no `release()` to leak on an early
return, and no way to open a second transaction inside the first — nesting is caught by an
`AsyncLocalStorage` detector, not by provider scope. Removing the mutable field is what
allowed `Scope.REQUEST` to go: concurrency was never coming from instance isolation, it
was coming from the Postgres row lock, so a shared singleton opening a fresh `QueryRunner`
per call is exactly as safe and considerably cheaper.

**Because narrowing per consumer makes the blast radius readable at the type level.**
`TransactionTxContext.budgetPeriodReader` cannot write a budget. Not "does not" — cannot;
the property is not on the type. That is a stronger statement than any comment, and it is
why the property is no longer called `budgets`.

## Alternatives considered

- **Option A — one global UoW exposing all repositories:** rejected. Every use case gets
  every repository, and the transactional surface stops documenting anything.
- **Option B — inject `DataSource` / `EntityManager` in use cases:** rejected. Puts
  TypeORM in the application layer and makes the lock model invisible; this is a standing
  anti-pattern in [`conventions.md`](../conventions.md#anti-patterns--do-not-do).
- **Option C — one impl serving several ports via `useExisting`:** this is what the code
  did, and the mechanism is still legitimate *within* a module. Rejected **across** module
  boundaries: it is the exact construct that produced both import cycles. It was only ever
  required by `CreateTransaction`, which `TypeOrmUnitOfWorkImpl` now serves by composing
  the scoped repositories internally inside `createContext()`.
- **Option D — stateful UoW with `begin`/`commit`/`rollback` (the previous design):**
  rejected in P3+P4. Five methods a use case can call in the wrong order, a mutable
  `QueryRunner` field, and `Scope.REQUEST` on every provider to contain it.
- **Option E — make the narrowed ports subtypes of the full ones:** rejected.
  `IScopedBudgetPeriodReader extends IScopedBudgetRepository` would inherit `save` and
  `delete`, which is the entire thing the narrowing exists to prevent.

## Consequences

**Positive**

- Zero `forwardRef()` in the module graph, and no route back to one that does not first
  re-declare a foreign UoW token.
- A use case's `TCtx` is an exact, greppable statement of which tables one atomic
  operation may touch, and how.
- Every UoW provider is a singleton; no request-scoped instantiation on the hot path.
- Commit/rollback/release cannot be got wrong, because they cannot be called.

**Negative / trade-offs**

- Four impls means four places where a change to the runner's contract lands — mitigated
  by all four extending `TypeOrmTransactionRunner`, which is the only file that touches a
  `QueryRunner`.
- A flow that genuinely spans two aggregates owned by different modules still has to
  choose an owner (transactions owns `CreateTransaction`/`DeleteTransaction`) and compose
  the neighbours' scoped repositories internally.
- Adding a repository to an existing flow means extending a `TCtx` and its
  `createContext()`, not just injecting something new — deliberate friction.
- Scoped repositories are reached through a factory taking a `QueryRunner`, not an
  `EntityManager`, so `dataSource.manager` does not compile — see
  [ADR-0009](./0009-scoped-repositories-as-guarded-factories.md).

**Follow-ups**

- Related: [ADR-0001](./0001-ports-as-abstract-classes.md) (why ports are `abstract
  class`), [ADR-0002](./0002-unit-of-work-pessimistic-locks.md) (the lock model),
  [ADR-0011](./0011-cache-strategy.md) (why cache composes where UoW inherits).
- The lock map this hierarchy carries is in
  [`concurrency-model.md`](../concurrency-model.md); the regression net is
  `test/integration/concurrency/concurrency.integration.spec.ts`.
