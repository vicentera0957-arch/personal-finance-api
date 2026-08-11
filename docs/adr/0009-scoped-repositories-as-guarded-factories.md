# ADR-0009: Scoped repositories cross module boundaries as guarded factories

- **Status:** Accepted
- **Date:** 2026-08-01
- **Deciders:** Vicente Cristobal Rivas Avello
- **Supersedes:** [ADR-0003](./0003-port-owned-by-consumer.md)

## Context and problem statement

`transactions` owns the only multi-aggregate invariant in this domain: creating an
expense must check the account balance and the budget's period limit, then write all
three, atomically. That forces it to hold scoped repositories for `accounts` and
`budgets` on **its own** `QueryRunner` — the `FOR UPDATE` locks are worthless
otherwise.

Historically this was solved by keeping every scoped repository private to
`transactions/infrastructure/persistence/unit-of-work.impl.ts`, and having
`transactions` declare the DI providers for its neighbours' UoW tokens. That closed
two module cycles (`accounts ↔ transactions`, `budgets ↔ transactions`) patched with
four `forwardRef()` calls, and it put the `FOR UPDATE` that protects the account
balance and the budget-period invariant in a file belonging to neither module.

ADR-0003 rationalised this as "port owned by consumer". That framing was accurate
for the DI graph but it hid the real problem: **`transactions` was declaring
providers for tokens it never injected.** The cycle was an artefact of composition,
not of the domain — no use case, entity, repository or mapper in `accounts` or
`budgets` ever imported anything from `transactions`.

The question this ADR answers: once each module owns its UoW, **how does a module
publish a locking repository so a neighbour can build it on a different
`QueryRunner`, without weakening the lock guarantee?**

## Decision

Each module owning an aggregate also owns its Unit of Work and the `FOR UPDATE`
policy for its own rows. When another module legitimately needs the same scoped
repository on its own transaction, the owning module exports a **guarded factory**:

```ts
// budgets/infrastructure/persistence/scoped-budget.repository.ts
class ScopedBudgetRepository extends IBudgetRepository { /* … */ }   // NOT exported

export function createScopedBudgetRepository(
  queryRunner: QueryRunner,          // ← not EntityManager
  mapper: BudgetMapper,
): IBudgetRepository {
  if (queryRunner.isReleased || !queryRunner.isTransactionActive) throw new Error(/* … */);
  return new ScopedBudgetRepository(queryRunner.manager, mapper);
}
```

The class is never exported. The factory is the only door.

Applied to: `createScopedAccountRepository`, `createScopedBudgetRepository`,
`createScopedExpenseChecker`. Scoped repositories with exactly one consumer stay
private to their UoW's file (`ScopedTransactionRepository`,
`ScopedRefreshTokenRepository`) — no factory needed until a second consumer appears.

## Why this option

The rule being protected is that a scoped repository only ever runs inside an active
transaction. Previously that was guaranteed **syntactically** — the class was private
to the file that handed it out. Exporting the class to a neighbour would trade that
structural guarantee for an unverifiable convention.

The failure mode is what decides it. `new ScopedBudgetRepository(dataSource.manager, mapper)`
compiles, runs, and returns correct-looking rows; Postgres grants the `FOR UPDATE`
and releases it the instant the `SELECT` ends. Nothing throws. Nothing logs. The
invariant simply stops being serialized, and it only surfaces as corruption under
concurrent load. **No integration test reliably catches it** — those tests are
timing-dependent and can serialize by accident on a fast machine.

The factory converts that silent failure into two loud ones:

1. **Compile time.** The parameter is `QueryRunner`, not `EntityManager`. Passing
   `dataSource.manager` stops compiling. Bypassing the contract now requires writing
   `dataSource.createQueryRunner()` on purpose — it can no longer happen by accident.
2. **Runtime.** `isReleased || !isTransactionActive` rejects the genuinely dangerous
   case: a runner that is connected but has no open transaction, which *looks*
   correct at every call site.

This is strictly stronger than what preceded it, where the UoW built scoped repos
from `this.queryRunner!.manager` with no validation at all — the `!` only covers
"I forgot to call `begin()`", not "wrong manager".

It also inverts ADR-0003's ownership claim in the right direction. Under this ADR the
`FOR UPDATE` protecting the budget row lives in `budgets`, and the one protecting the
account row lives in `accounts` — where a maintainer of those modules will look for
it.

## Alternatives considered

- **Export the scoped class directly.** One definition of the lock, smallest diff.
  Rejected: every `EntityManager` satisfies the constructor, including a
  non-transactional one, and the type system cannot tell them apart. It trades a
  structural guarantee for a comment.
- **Let `transactions` keep private copies.** Keeps the guarantee intact in both
  modules. Rejected: two sources of truth for the logical mutex of the period
  invariant. A `WHERE` clause or lock mode changed in one copy and not the other
  breaks the invariant *only* under concurrency, and only on one of the two paths.
  No test can detect the divergence — unit tests mock the ports, integration tests
  exercise one path at a time. Same failure shape as the `isBudgetable` flag this
  codebase already removed for having two sources of truth.
- **A neutral persistence module owning every UoW.** Breaks both cycles and is
  cheaper. Rejected: it institutionalises a false claim — that a shared transactional
  context exists across the financial core — when `accounts`, `budgets` and `auth`
  are demonstrably self-sufficient. It also creates a hub that must import every ORM
  entity and mapper, and the multi-aggregate UoW survives intact, merely relocated.
- **`AsyncLocalStorage` for implicit transaction propagation.** Would dissolve the
  problem entirely. Rejected: this codebase's principal documentation asset is the
  explicit lock and serialization map. Making the most delicate mechanism in the
  system implicit is a legibility regression, and it hides ownership rather than
  resolving it.

## Consequences

**Positive**

- The module graph is acyclic. Zero `forwardRef()` calls remain.
- The `FOR UPDATE` for each aggregate lives in the module that owns the aggregate.
- The lock contract is enforced by the compiler, not by convention.
- Each UoW is now an independent unit, so converting them to stateless runners can
  proceed module by module instead of as one big-bang change.

**Negative / trade-offs**

- One extra file and roughly eight lines per published scoped repository.
- **A guarantee was genuinely lost.** Before the split, aliasing every UoW port to one
  request-scoped instance via `useExisting` made it *structurally impossible* for a
  single request to open two DB transactions. Now a use case injecting two UoW ports
  would get two instances, two connections, two transactions — and could deadlock
  against itself, holding a `FOR UPDATE` in one while waiting for it in the other.
  No use case does this today (verified across all eight that take a UoW), but it
  moved from impossible to merely unwritten. Mitigated by an explicit anti-pattern in
  `CLAUDE.md`: **a use case injects at most one UoW port**; coordinating two
  aggregates is the job of the UoW that owns the multi-aggregate boundary.

**Follow-ups**

- ~~The factories currently return the full repository port. Narrowing them to bounded
  command ports (the `IScopedTransactionRepository` precedent) is the obvious next step;
  the factory return type is the exact seam where it happens.~~ **Done** (2026-08-04):
  `createScopedAccountRepository` and `createScopedBudgetRepository` now return narrow
  sibling ports, and `createScopedBudgetPeriodReader` was added as a read-only view over
  the same class. A compile-only type-test enforces it. See
  [`structural-refactors.md`](../history/structural-refactors.md), P5.
- The "guarantee genuinely lost" above is now **partly** recovered: an
  `AsyncLocalStorage` nesting detector throws `NestedTransactionError` when a second
  `run()` starts on the same async chain, so the self-deadlock case this ADR worried
  about fails loudly instead of hanging. Two `run()` calls racing via `Promise.all` are
  still invisible to it — different async chains — and remain an accepted cost.
