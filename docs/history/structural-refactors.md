# Structural refactors P1–P7 (August 2026)

A seven-item inventory of structural problems in the coupling between `transactions`,
`accounts`, `budgets` and `auth` — decomposed into independent, individually shippable
units, then closed one at a time between 2026-08-01 and 2026-08-06. **All seven are
closed.** This is a point-in-time record, not living guidance: the rules that came out of
it are in [`CLAUDE.md`](../../CLAUDE.md) and [`concurrency-model.md`](../concurrency-model.md).

None of the seven was a bug except P7. The app booted, the locks worked, the suite passed.
They were latent traps — the kind that cost nothing today and a lot once the codebase grows
— plus one duplication. Saying that plainly matters: the refactor was worth doing, but not
because anything was broken.

## The framing that made the decomposition possible

Three facts, established before any code moved. Without them the inventory reads wrong.

**1. The three aggregates are welded by the invariant, not by the code.** `Σ period
expenses ≤ limit` and `balance ≥ 0` are both read-before-write guards, and both fire on the
same event: creating a transaction. The real transactional aggregate in this domain isn't
`Transaction` — it's the triple. So `transactions` doesn't *depend on* `accounts` and
`budgets`; `transactions` is *where the invariant of all three lives*. That arrow is
legitimate and permanent, and none of the seven problems proposed touching it.

**2. What serializes concurrent requests is the row lock, not a shared instance.** Two
concurrent requests always had distinct `QueryRunner`s, distinct connections and distinct DB
transactions — first because `Scope.REQUEST` meant one instance per request, and after P3
because every `run()` call opens its own runner. The only thing that ever serialized them on
the same row was Postgres holding `FOR UPDATE` until commit. **Splitting the UoW could not
weaken any concurrency guarantee**, because between requests nothing was ever shared. This
is the fact that unblocked P1 and P2.

**3. The module cycles were an artefact of composition, not of the domain.** They lived
between the `.module.ts` files. No use case, entity, repository or mapper in `accounts` or
`budgets` imported anything from `transactions` — `transactions` was simply declaring DI
providers for tokens it never injected.

## The seven

| # | Problem | Closed by | Commits |
| --- | --- | --- | --- |
| **P1** | `accounts ↔ transactions` module cycle | `accounts` owns `AccountUnitOfWorkImpl` + its `FOR UPDATE` | `91de97b` · `b026ac8` · `19eed72` |
| **P2** | `budgets ↔ transactions` module cycle (the last one) | `budgets` owns `BudgetUnitOfWorkImpl` and `ScopedExpenseChecker` | `83d4c15` · `dc35dc7` · `ac40f03` · `b140cf4` |
| **P7** | Cache invalidation inside the transaction's error scope | Invalidation moved after `run()` resolves, into its own logging-only `try/catch` | `0d3f3d5` |
| **P3** | `Scope.REQUEST` contagion through the DI graph | Stateless runner — no mutable `QueryRunner` field, so no request scope needed | `48bd93f` · `c9f5280` |
| **P4** | Transaction lifecycle duplicated across 4 impls | `TypeOrmTransactionRunner.run()` owns connect → begin → commit/rollback → release, written once | `48bd93f` · `c9f5280` |
| **P5** | Neighbour-facing scoped ports were too wide | Narrow sibling ports + a compile-only type-test | `bdb117d` · `745e70a` |
| **P6** | "Σ period expenses" SQL duplicated character-for-character | One `sumPeriodExpenses()` function, called on each caller's own `EntityManager` | `baa0dac` |

### P1 + P2 — the module cycles

`transactions.module.ts` declared the providers for `IAccountUnitOfWork` and
`IBudgetUnitOfWork` — two tokens `transactions` itself never injected — which forced
`accounts` and `budgets` to import `TransactionsModule` just to resolve them.
`budgets` needed `forwardRef(() => TransactionsModule)` on top, because `IExpenseChecker`'s
implementation also lived in `transactions/infrastructure/persistence/unit-of-work.impl.ts`.

Both closed the same way, and *not* by keeping the `forwardRef()` split: the implementation
moved into the module that owns the port. `AccountUnitOfWorkImpl`, `BudgetUnitOfWorkImpl`
and `ScopedExpenseChecker` now live next to the ports they serve. The module graph has
**zero cycles and zero `forwardRef()` calls**.

The one thing that genuinely had to be solved: `CreateTransaction` still needs its
neighbours' locking repositories on **its own** `QueryRunner`. That is what
[ADR-0009](../adr/0009-scoped-repositories-as-guarded-factories.md) answers — the owning
module publishes a **guarded factory**, never the class.

### P7 — the only actual bug

Cache invalidation in `DeleteBudget` / `UpdateBudgetLimit` ran inside the `try` whose
`catch` called `rollback()`. A Redis hiccup after a successful commit would therefore call
`rollback()` on an already-committed transaction. Fixed by moving invalidation after
`await uow.run(...)` resolves, into its own `try/catch` that only logs.

P3+P4 later turned that fix into a structural fact rather than a rule to remember: the only
`try` with a `rollback()` in its `catch` is now private to `TypeOrmTransactionRunner.run()`,
and no use-case code runs inside it. There is nowhere else to put invalidation.

### P3 + P4 — the stateless runner

One surgery closed both. The UoW went from a state machine
(`begin`/`commit`/`rollback`/`release`/`isConnected`, a mutable `QueryRunner` field,
`Scope.REQUEST` on every provider) to a runner with a single method:

```ts
export abstract class IUnitOfWork<TCtx> {
  abstract run<T>(work: (ctx: TCtx) => Promise<T>): Promise<T>;
}
```

The `QueryRunner` lives on the call stack instead of in a field. Two consequences follow:
no mutable field means the impls are **singletons**, so nothing propagates `Scope.REQUEST`
(P3); and `release()` sits in a `finally` written **once** in a base class, so it cannot be
forgotten (P4). All four impls are singletons, no provider in the graph is request-scoped,
and the seven domain controllers resolve once per process —
[`test/integration/di-scope.integration.spec.ts`](../../test/integration/di-scope.integration.spec.ts)
proves that rather than assuming it.

The runner also carries an `AsyncLocalStorage` nesting detector
(`active-transaction.storage.ts`) holding only `{ owner: string }`. It throws
`NestedTransactionError` when a second `run()` starts on the same async chain, instead of
hanging silently until `lock_timeout`. It is a diagnostic, **not** transaction propagation —
see the distinction in `CLAUDE.md`'s anti-patterns, and "rejected candidates" below.

### P5 — narrow ports for neighbouring aggregates

`ctx.accounts` and `ctx.budgets` in `TransactionTxContext` were typed as the full global
ports, so `CreateTransactionUseCase` could — by type — `delete()` a neighbour's aggregate
inside its own transaction. Nothing used that capability; nothing prevented it either.

Three sibling ports close it: `IScopedAccountRepository` (`findByIdWithLock` + `save`),
`IScopedBudgetRepository` (adds `delete`, because `budgets`' own UoW owns that aggregate)
and `IScopedBudgetPeriodReader` (the single read `CreateTransaction` needs). They are
**siblings, not subtypes** — none `extends` a global repo port, because inheriting would
drag along the very writes being removed. `ctx.budgets` was renamed to
`ctx.budgetPeriodReader` so the name stops implying a capability that consumer never had.

The narrowing is a return-type view over one class: `createScopedBudgetRepository` and
`createScopedBudgetPeriodReader` build the identical `ScopedBudgetRepository` off one
`QueryRunner`. Zero duplicated SQL. A compile-only type-test
([`uow-narrowing.type-test.ts`](../../src/modules/transactions/domain/__type-tests__/uow-narrowing.type-test.ts),
gated by `npm run build`) fails if a scoped context ever regains `save`/`delete` on an
aggregate its consumer doesn't own.

### P6 — one owner for "Σ period expenses"

`ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod` and
`ScopedExpenseChecker.sumExpenseAmountInPeriod` were the same statement character for
character — same `COALESCE(SUM(e.amount), 0)`, same `FROM v_period_expenses e`, same four
filters. All the investment in `v_period_expenses` (one definition of "what counts as an
expense") was being partly wasted one level up, with no test that would have caught a
divergence.

The classes were **not** collapsed: they run on different `EntityManager`s, from two
independent UoWs. What was duplicated is the statement, not the object executing it. Both
now delegate to `sumPeriodExpenses()`
([`shared/infrastructure/persistence/period-expenses.query.ts`](../../src/shared/infrastructure/persistence/period-expenses.query.ts)).
The two method names stayed: each documents its consumer's question under its own lock, not
the query itself.

## Candidates examined and rejected

Listed so nobody "fixes" them later without knowing what they'd buy.

**Duplicated reads — deliberate trade, not a defect.** `CreateTransaction` reads the account
and the budget without a lock (via the global use cases) and re-reads them under lock inside
the UoW. That buys cheap 404/403 without taking a pool connection. It costs round-trips on
the happy path, and it is what forces the application-level import of the neighbours.
Conscious.

**In-process events / outbox to decouple the cross-aggregate writes — incoherent.** The two
cross-aggregate writes are **guards**, not projections: conditional gates on the write.
Moving them to a handler turns "reject the transaction" into "accept, discover the
violation, compensate" — swapping an invisible rollback for a user-visible correction. And
in-process rescues nothing: either the handler runs inside the same transaction (same
coupling, worse traceability) or post-commit without a durable queue (eventual consistency
without durability — a dual write with an in-memory queue). On top of that, `Σ expenses ≤
limit` is an invariant over a *set of rows*: not expressible as a DB constraint, so it
requires read-then-write under serialization. All three ways to enforce it (pessimistic lock
on a mutex row, `SERIALIZABLE` + retry, or materialising the sum with a `CHECK`) are
synchronous and transactional.

**Balance as derived state (`SUM` of transactions) — futile.** It adds no eventuality but
removes no transaction: the balance is *also* a guard (`InsufficientFundsException` in
`outflow()`). The derived flow is still read-then-write with the same races and the same
need to serialize. It trades an O(1) locked read for an O(n) aggregate under the same lock.
More expensive, zero decoupling gained.

**`AsyncLocalStorage` for implicit transaction propagation — incoherent for this project.**
It would dissolve P3, P4 and P5 at the root, by making the most delicate mechanism in the
system implicit. In a codebase whose principal documentation asset is the explicit lock and
serialization map, trading explicit for implicit is a legibility regression — and it hides
ownership rather than resolving it.

> Nuance, after P3+P4 landed: the runner *does* use `AsyncLocalStorage`
> (`activeTransaction`). What was rejected here is using it **to propagate** the
> transactional context — a caller receiving an `EntityManager`/`QueryRunner` ambiently
> instead of as an explicit parameter. The runner's store carries only `{ owner: string }`
> and its only effect is detecting a nested `run()`. The context still travels exclusively
> as `run()`'s callback parameter. Test for whether something is propagation: delete it and
> ask what data flow changes. Delete `activeTransaction` and the transactional model is
> byte-for-byte identical — the only loss is the diagnostic.

## Where the original planning documents live

Five Spanish working documents (`PROBLEMS.md` and four `PLAN-P*.md`, ~1,900 lines) drove
this work from `src/`. They were removed once every problem closed; this page replaces them.
Citations elsewhere in the codebase that reference a section number (`PLAN-P3P4 §2.4.b`,
`PLAN-P5 §10.3`, `PROBLEMS.md P6`) point into those files — recover them with:

```bash
git show 7a12679:src/PROBLEMS.md
```

Same for `src/PLAN-P3P4-transactional-runner.md`, `src/PLAN-P5-narrow-ports.md`,
`src/PLAN-P6-unify-period-expenses-query.md` and `src/PLAN-P7-cache-rollback.md`. The
longest P3+P4 draft (1,153 lines — full auto-deadlock analysis, TypeORM rollback-path table)
is at `git show b64d580:src/PLAN-P3P4-transactional-runner.md`. The P1/P2 plans were already
deleted when those closed: `git show ba62266:src/PLAN-P1P2-budgets.md`.

## Related

- [ADR-0009](../adr/0009-scoped-repositories-as-guarded-factories.md) — guarded factories, the decision that made P1/P2 possible (supersedes ADR-0003)
- [`concurrency-model.md`](../concurrency-model.md) — the live lock map this refactor preserved
- [`closed-race-conditions.md`](./closed-race-conditions.md) — the seven races, a separate and earlier body of work
