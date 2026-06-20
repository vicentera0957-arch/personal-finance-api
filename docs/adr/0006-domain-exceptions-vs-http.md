# ADR-0006: Domain throws domain exceptions; controllers map to HTTP

- **Status:** Draft
- **Date:** YYYY-MM-DD
- **Deciders:** Vicente Cristobal Rivas Avello

## Context and problem statement

The domain layer must stay free of framework/HTTP concerns to remain testable and
portable. But every error eventually needs an HTTP status.

> Fact from the code: domain throws plain `Error` subclasses
> (e.g. `BudgetNotFoundException`, `ResourceOwnershipException`), and each controller
> translates them via `instanceof` checks in `try/catch`
> ([`transactions.controller.ts`](../../src/modules/transactions/infrastructure/http/transactions-controller/transactions.controller.ts)).
> The exception→HTTP mapping table lives in the project docs. There is a standing
> `TODO(tech-debt)` to replace the per-controller `try/catch` with a single global
> `@Catch()` exception filter. No global filter exists today.

## Decision

The domain has zero HTTP knowledge and throws domain exceptions. Controllers own the
translation to HTTP status codes.

## Why this option

<!--
The principle (domain ignorant of HTTP) is clear. The open question is the MECHANISM:
was the per-controller try/catch a deliberate choice (explicit, local, easy to read)
or accumulated debt? What's your stance on moving to a global filter — and why hasn't
it happened yet?
-->

## Alternatives considered

- **Throw `HttpException` from the domain:** rejected — couples domain to NestJS/HTTP.
- **Global `@Catch()` exception filter mapping domain → HTTP centrally:** <!-- Why not (yet)? -->

## Consequences

**Positive**

- Domain stays pure and unit-testable without HTTP.

**Negative / trade-offs**

- Mapping logic is duplicated across controllers; a new domain exception not added to a
  controller leaks as a 500. Covered by controller tests, but easy to forget.

**Follow-ups**

- <!-- Decide on the global filter. If/when done, supersede this ADR. -->
