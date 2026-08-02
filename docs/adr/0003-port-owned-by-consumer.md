# ADR-0003: "Port owned by consumer" to break module cycles

- **Status:** Draft
- **Date:** YYYY-MM-DD
- **Deciders:** Vicente Cristobal Rivas Avello

> **Needs a supersede.** The "Fact from the code" paragraph below is now historical:
> `IExpenseChecker`'s implementation moved from `transactions` into `budgets` (next
> to the port), and `IAccountUnitOfWork` moved from `transactions` into `accounts`
> the same way. Neither is a live example of this pattern anymore — the module
> graph currently has zero cycles and zero `forwardRef()` calls. The decision
> record and its reasoning are still correct for the case where a genuine
> cross-module dependency reappears; a follow-up ADR should supersede this one
> with an up-to-date example, or note explicitly that the pattern is currently
> unused. See `docs/architecture.md` §2.1 for the current state.

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

<!--
Did you arrive at this after a circular-dependency error blew up, or design it
up front? Why keep the port with the consumer instead of, say, extracting a third
shared module, or merging the two modules?
-->

## Alternatives considered

- **Extract a shared/third module for the contract:** <!-- Why rejected? over-engineering? -->
- **Merge the two modules:** <!-- Why rejected? loss of boundaries? -->
- **Domain events / mediator instead of a direct port:** <!-- Why rejected? -->

## Consequences

**Positive**

- Clean one-way domain dependency even where DI needs `forwardRef()`.

**Negative / trade-offs**

- `forwardRef()` is a known NestJS sharp edge; readers must understand the pattern.

**Follow-ups**

-
