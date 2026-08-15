# Architecture Decision Records

An ADR captures **one significant design decision**: the context that forced it,
the option chosen, the alternatives rejected, and the consequences. They explain
the _why_ behind the code so a reader doesn't have to reverse-engineer intent.

Format: lightweight [MADR](https://adr.github.io/madr/). Template: [`0000-template.md`](./0000-template.md).

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](./0001-ports-as-abstract-classes.md) | Ports are `abstract class`, not `interface`, so they work as DI tokens | Accepted |
| [0002](./0002-unit-of-work-pessimistic-locks.md) | Unit of Work + pessimistic row locks for cross-aggregate invariants | Accepted |
| [0003](./0003-port-owned-by-consumer.md) | "Port owned by consumer" to break module cycles | **Superseded by [0009](./0009-scoped-repositories-as-guarded-factories.md)** |
| [0004](./0004-refresh-token-rotation.md) | Refresh-token rotation with family revocation on replay | Accepted |
| [0005](./0005-single-entry-immutable-transactions.md) | Single-entry, immutable transactions (not a double-entry ledger) | Accepted |
| [0006](./0006-domain-exceptions-vs-http.md) | Domain throws domain exceptions; controllers map to HTTP | Accepted |
| [0007](./0007-migrations-over-synchronize.md) | Schema via migrations, never `synchronize` | Accepted |
| [0008](./0008-redis-cache-ports.md) | Redis behind a minimal cache-store port; per-module caches by composition | Accepted |
| [0009](./0009-scoped-repositories-as-guarded-factories.md) | Scoped repositories cross module boundaries as guarded factories | Accepted |
| [0010](./0010-keyset-pagination.md) | Keyset pagination for transaction listings | **Proposed** |

## Where to start

If you only read two: **[0002](./0002-unit-of-work-pessimistic-locks.md)** is the
project's core engineering decision (why pessimistic locks instead of `SERIALIZABLE`),
and **[0009](./0009-scoped-repositories-as-guarded-factories.md)** is the one that
corrects an earlier ADR — it shows what changed and why 0003 was the wrong diagnosis.

**0003 is deliberately kept, not deleted.** A superseded ADR that records a mistake and
its correction is worth more than a clean record with the mistake edited out.
