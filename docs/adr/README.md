# Architecture Decision Records

An ADR captures **one significant design decision**: the context that forced it,
the option chosen, the alternatives rejected, and the consequences. They explain
the _why_ behind the code so a reader doesn't have to reverse-engineer intent.

Format: lightweight [MADR](https://adr.github.io/madr/). Template: [`0000-template.md`](./0000-template.md).

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](./0001-ports-as-abstract-classes.md) | Ports are `abstract class`, not `interface`, so they work as DI tokens | Draft |
| [0002](./0002-unit-of-work-pessimistic-locks.md) | Unit of Work + pessimistic row locks for cross-aggregate invariants | Draft |
| [0003](./0003-port-owned-by-consumer.md) | "Port owned by consumer" to break module cycles | Draft |
| [0004](./0004-refresh-token-rotation.md) | Refresh-token rotation with family revocation on replay | Draft |
| [0005](./0005-single-entry-immutable-transactions.md) | Single-entry, immutable transactions (not a double-entry ledger) | Draft |
| [0006](./0006-domain-exceptions-vs-http.md) | Domain throws domain exceptions; controllers map to HTTP | Draft |
| [0007](./0007-migrations-over-synchronize.md) | Schema via migrations, never `synchronize` | Draft |
| [0008](./0008-redis-cache-ports.md) | Redis behind a minimal cache-store port; per-module caches by composition | Accepted |

> **Status `Draft`** = the _what_ is filled in from the code; the _why_ / _alternatives_
> are pending the author's input. Once completed, flip to `Accepted`.
