# ADR-0001: Ports are `abstract class`, not `interface`

- **Status:** Draft <!-- flip to Accepted once the "why" is filled in -->
- **Date:** YYYY-MM-DD
- **Deciders:** Vicente Cristobal Rivas Avello

## Context and problem statement

The codebase follows Ports & Adapters: the domain/application layers depend on
**ports** (repositories, Unit of Work, cache, hashers, token providers) and the
infrastructure layer provides the **adapters**. NestJS resolves dependencies by a
**runtime token**. A TypeScript `interface` is erased at compile time, so it cannot
serve as a token — there is nothing left at runtime to inject against.

> Fact from the code: ports such as
> [`TransactionRepository`](../../src/modules/transactions/domain/repository/transaction.repository.ts)
> and [`ITransactionUnitOfWork`](../../src/modules/transactions/domain/ITransactionUnitOfWork.ts)
> are declared as `abstract class` and bound with
> `{ provide: IFoo, useClass: FooImpl }` (and `useExisting` for the shared UoW).

## Decision

Every port is an `abstract class`. It doubles as the **type** (for the domain) and
as the **DI token** (for NestJS). Concrete adapters are bound in the module providers.

## Why this option

<!--
Your call: was this a deliberate choice from day 1, or discovered while fighting
Nest's DI? What did you optimise for — ergonomics, no extra token boilerplate,
readability? See `cache-decision.md` if you already wrote part of this rationale.
-->

## Alternatives considered

- **`interface` + `@Inject('STRING_TOKEN')` / `Symbol` token:** the classic Nest
  workaround. <!-- Why rejected? (string typos, token/type drift, more boilerplate?) -->
- **`interface` with no DI (manual wiring):** <!-- Why rejected? -->

## Consequences

**Positive**

- Port is type and token in one declaration; no parallel token registry to keep in sync.

**Negative / trade-offs**

- Switching any port to a plain `interface` breaks the DI graph — this is now a hard rule.
- <!-- anything else? -->

**Follow-ups**

-
