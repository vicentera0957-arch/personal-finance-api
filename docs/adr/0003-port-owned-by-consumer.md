# ADR-0003: "Port owned by consumer" to break module cycles

- **Status:** Superseded by [ADR-0009](./0009-scoped-repositories-as-guarded-factories.md)
- **Date:** 2026-06-20 · superseded 2026-08-01
- **Deciders:** Vicente Cristobal Rivas Avello

> **Superseded — kept as a record, not as guidance.** Both examples this ADR rested on are gone:
> `IExpenseChecker`'s implementation moved from `transactions` into `budgets` (next to its port),
> and `IAccountUnitOfWork` moved from `transactions` into `accounts` the same way. The module graph
> now has **zero cycles and zero `forwardRef()` calls**, so the pattern has no live instance.
>
> What replaced it: each module owns its Unit of Work and the `FOR UPDATE` policy for its own rows,
> and publishes a **guarded factory** when a neighbour needs the same scoped repository on a
> different `QueryRunner`. See [ADR-0009](./0009-scoped-repositories-as-guarded-factories.md).
>
> The reasoning below remains valid for the case it describes — a genuine bidirectional need
> between two modules. It just is not this codebase's situation: the cycle here was an artefact of
> composition, because `transactions` declared DI providers for tokens it never injected.

## Context and problem statement

`transactions` depends on `accounts` and `budgets`. But those modules sometimes
need to ask `transactions` a question (e.g. "are there expenses in this period?"),
which would create a circular module dependency.

> Fact from the code (historical — see the supersede note above): the port `IExpenseChecker` was
> declared in **budgets'** domain
> ([`expense-checker.port.ts`](../../src/modules/budgets/domain/ports/expense-checker.port.ts),
> moved again since from `domain/repository/` to `domain/ports/` — it answers a derived query, not
> a persistence lifecycle)
> and implemented by `ScopedExpenseChecker` in **transactions'** infrastructure
> ([`unit-of-work.impl.ts`](../../src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts)).
> The same shape applied to `IAccountUnitOfWork`. `forwardRef()` resolved the NestJS DI graph.

## Decision

When module A needs something from module B but B already depends on A, the **port is
defined in A's domain** and the **implementation lives in B's infrastructure**. The
dependency direction at the domain layer stays one-way; `forwardRef()` only patches DI.

## Why this option

The reasoning at the time: `budgets` needed an answer only `transactions` could give
("are there expenses in this period?"), and `transactions` already imported `budgets`.
Defining the port in `budgets` keeps the **domain** dependency one-way — `budgets`
declares what it needs, `transactions` supplies it — and confines the cycle to the DI
layer, where `forwardRef()` can patch it.

That reasoning is sound for the situation it describes. **It was the wrong diagnosis of
this situation**, and naming the error is the useful part of keeping this ADR:
`transactions` was declaring DI providers for tokens it never injected. Nothing in
`budgets` or `accounts` imported anything from `transactions` at the domain,
application or persistence layer. There was no bidirectional *need* — only a
bidirectional *wiring*, which this ADR then rationalised as a pattern instead of
questioning.

The tell was available and missed: a genuine two-way dependency shows up in the code
that does the work, not only in the `.module.ts` files. When a cycle exists **only** in
composition, the fix is to move the implementation, not to justify the cycle.

## Alternatives considered

- **Move the implementation into the module that owns the port.** Not seriously
  considered at the time, on the mistaken belief that competing for the same row lock
  required the same UoW instance. It doesn't — the lock lives in Postgres and is visible
  across connections. **This is what eventually shipped**; see
  [ADR-0009](./0009-scoped-repositories-as-guarded-factories.md).
- **Extract a shared/third module for the contract.** Rejected: a module that exists
  only to hold one port is indirection without a reader, and it would still leave the
  implementation in the wrong place.
- **Merge `budgets` and `transactions`.** Rejected: they have genuinely separate
  aggregates, invariants and lifecycles. Merging would dissolve a boundary that carries
  real meaning to remove a DI artefact.
- **Domain events / a mediator instead of a direct port.** Rejected: the call is a
  synchronous *guard* (block the delete if expenses exist), not a notification. An event
  turns "reject" into "accept, then discover, then compensate".

## Consequences

**Positive**

- Clean one-way domain dependency even where DI needs `forwardRef()`.

**Negative / trade-offs**

- `forwardRef()` is a known NestJS sharp edge; readers must understand the pattern.
- The `FOR UPDATE` protecting the budget row ended up in a file belonging to
  `transactions` — where no maintainer of `budgets` would look for it. That misplacement
  is the concrete cost this ADR's framing hid, and the main reason ADR-0009 replaced it.

**Follow-ups**

- Superseded. The pattern stays documented as the correct fix *if* a genuine
  bidirectional dependency ever appears; it has no live instance in this codebase.
