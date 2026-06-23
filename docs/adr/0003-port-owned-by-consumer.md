# ADR-0003: "Port owned by consumer" to break module cycles

- **Status:** Draft
- **Date:** YYYY-MM-DD
- **Deciders:** Vicente Cristobal Rivas Avello

## Context and problem statement

`transactions` depends on `accounts` and `budgets`. But those modules sometimes
need to ask `transactions` a question (e.g. "are there expenses in this period?"),
which would create a circular module dependency.

> Fact from the code: the port `IExpenseChecker` is declared in **budgets'** domain
> ([`expense-checker.port.ts`](../../src/modules/budgets/domain/repository/expense-checker.port.ts))
> and implemented by `ScopedExpenseChecker` in **transactions'** infrastructure
> ([`unit-of-work.impl.ts`](../../src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts)).
> The same shape applies to `IAccountUnitOfWork`. `forwardRef()` resolves the NestJS DI graph.

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
