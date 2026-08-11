# ADR-0001: Ports are `abstract class`, not `interface`

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Vicente Cristobal Rivas Avello

## Context and problem statement

The codebase follows Ports & Adapters: the domain/application layers depend on
**ports** (repositories, Unit of Work, cache, hashers, token providers) and the
infrastructure layer provides the **adapters**. NestJS resolves dependencies by a
**runtime token**. A TypeScript `interface` is erased at compile time, so it cannot
serve as a token — there is nothing left at runtime to inject against.

> Fact from the code: 23 ports — repositories, Units of Work, caches, the password
> hasher, the token provider — are declared as `abstract class` and bound with
> `{ provide: IFoo, useClass: FooImpl }`. Examples:
> [`TransactionRepository`](../../src/modules/transactions/domain/repository/transaction.repository.ts),
> [`ITransactionUnitOfWork`](../../src/modules/transactions/domain/ITransactionUnitOfWork.ts).

## Decision

Every port is an `abstract class`. It doubles as the **type** (for the domain) and
as the **DI token** (for NestJS). Concrete adapters are bound in the module providers.

## Why this option

The constraint is not negotiable: Nest needs something that exists at runtime. What
*is* a choice is which runtime thing. An `abstract class` is the only option where the
type and the token are **the same declaration**, so they cannot drift apart.

That single-declaration property is what pays off. With a separate token, the compiler
checks that the impl matches the interface and that the consumer's field matches the
interface — but nothing checks that the token injected into that field points at an
impl of *that* interface. The mismatch surfaces at boot, or worse, at the first call.
With `abstract class`, `@Inject()` isn't even needed: Nest reads the constructor
parameter type via metadata, so the type annotation **is** the wiring.

## Alternatives considered

- **`interface` + `@Inject('STRING_TOKEN')` or a `Symbol`.** The classic Nest
  workaround. Rejected: two declarations per port that must be kept in sync by hand,
  a token registry to maintain, and `@Inject()` on every constructor parameter. String
  tokens add typo risk with no compiler help. It buys nothing here — nothing in this
  codebase needs a port to be structurally typed.
- **`interface` with no DI (manual wiring in a composition root).** Rejected: it means
  giving up Nest's module system, which is what provides request lifecycle, testing
  overrides (`overrideProvider` in the integration suite) and lazy resolution. Too much
  to pay to avoid one keyword.

## Consequences

**Positive**

- Port is type and token in one declaration; no parallel token registry to keep in sync.
- No `@Inject()` boilerplate — the constructor parameter type does the wiring.
- Test doubles bind the same way (`{ provide: IFoo, useClass: InMemoryFoo }`).

**Negative / trade-offs**

- Switching any port to a plain `interface` breaks the DI graph — this is now a hard rule.
- `abstract class` emits a real JS class, so a port costs a few bytes at runtime where
  an `interface` would cost nothing. Irrelevant at 23 ports.
- One documented exception: `TCtx` context shapes (`TransactionTxContext`, …) *are*
  `interface`, because they are never injected — they only type `run()`'s callback
  parameter. The rule is "everything injected is an `abstract class`", not "no
  interfaces anywhere".

**Follow-ups**

- None. This is settled and enforced by the DI graph itself: a violation fails at boot.
