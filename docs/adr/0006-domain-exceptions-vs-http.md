# ADR-0006: Domain throws domain exceptions; controllers map to HTTP

- **Status:** Accepted
- **Date:** 2026-06-20
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

The principle is standard and not really in question: an exception is part of a
method's contract, and if the domain throws `NotFoundException` from `@nestjs/common`,
then the domain's contract is written in HTTP. Every domain unit test would import
Nest, and moving this code behind a queue or a CLI would mean rewriting the error model.
`BudgetNotFoundException extends Error` says what happened in the language of the
domain; **404 is an opinion about that fact, and opinions belong at the edge.**

The part that *was* a real choice is the mechanism, and it is honestly split:

The per-controller `try/catch` is **explicit and local** — reading a controller shows
you exactly which failures that endpoint produces, without jumping to a filter file.
For a codebase whose main documentation asset is explicitness, that has genuine value,
and it is the same argument that keeps the lock model explicit elsewhere.

But it does not scale, and the failure mode is bad: a new domain exception that nobody
adds to a controller doesn't fail loudly — it falls through as a **500**. The mapping
table in `CLAUDE.md` and the rule "every mapping is covered by at least one controller
test" are compensating controls for a structural gap, which is a smell.

A global `@Catch()` filter is the better end state and the `TODO(tech-debt)` in
`transactions.controller.ts` says so. It hasn't happened because the honest cost/benefit
at seven controllers is thin: the mapping is written and tested, and moving it is a
refactor with no user-visible change. It becomes worth doing at the next controller, or
the first time the 500 fallthrough actually bites.

Recording that as a deliberate deferral, rather than leaving it implied, is the point of
this section.

## Alternatives considered

- **Throw `HttpException` from the domain.** Rejected: couples the domain to
  NestJS/HTTP, and makes the error model untestable and unportable outside a web
  request.
- **Global `@Catch()` exception filter mapping domain → HTTP centrally.** Not rejected
  — deferred. One mapping table instead of seven, and an unmapped exception can be made
  to fail loudly in one place. The cost is indirection: the controller no longer states
  its own failure modes. Tracked as `TODO(tech-debt)`; see above for why not yet.
- **Return a `Result<T, DomainError>` type instead of throwing.** Rejected: it would
  make the error path type-checked end to end, which is the strongest option on paper,
  but it means threading a result type through every use case and controller in a
  codebase that is otherwise idiomatic exception-based TypeScript. Not worth adopting
  a second error paradigm for.

## Consequences

**Positive**

- Domain stays pure and unit-testable without HTTP.
- Each controller documents its own failure modes at the call site.

**Negative / trade-offs**

- Mapping logic is duplicated across controllers; a new domain exception not added to a
  controller leaks as a 500. Covered by controller tests, but easy to forget.
- The exception→HTTP table in `CLAUDE.md` is a second source of truth that has to be
  updated in the same PR as the controller. That coupling is a rule, not a mechanism.

**Follow-ups**

- Move to a global `@Catch()` filter when a new controller is added or the 500
  fallthrough is hit in practice. Supersede this ADR then.
