# Architecture Decision Records

- **Last updated:** 2026-08-30

An ADR captures **one significant design decision**: the context that forced it,
the option chosen, the alternatives rejected, and the consequences. They explain
the _why_ behind the code so a reader doesn't have to reverse-engineer intent.

Format: lightweight [MADR](https://adr.github.io/madr/). Template: [`0000-template.md`](./0000-template.md).

Dates are ISO 8601 (`YYYY-MM-DD`) and record **when the decision was taken**, not when the
ADR was written — several of these were distilled from older design notes and say so in
their header.

| ADR | Decision | Date | Status |
| --- | --- | --- | --- |
| [0001](./0001-ports-as-abstract-classes.md) | Ports are `abstract class`, not `interface`, so they work as DI tokens | 2026-06-20 | Accepted |
| [0002](./0002-unit-of-work-pessimistic-locks.md) | Unit of Work + pessimistic row locks for cross-aggregate invariants | 2026-06-20 | Accepted |
| [0003](./0003-port-owned-by-consumer.md) | "Port owned by consumer" to break module cycles | 2026-06-20 | **Superseded by [0009](./0009-scoped-repositories-as-guarded-factories.md)** |
| [0004](./0004-refresh-token-rotation.md) | Refresh-token rotation with family revocation on replay | 2026-06-20 | Accepted |
| [0005](./0005-single-entry-immutable-transactions.md) | Single-entry, immutable transactions (not a double-entry ledger) | 2026-06-20 | Accepted |
| [0006](./0006-domain-exceptions-vs-http.md) | Domain throws domain exceptions; controllers map to HTTP | 2026-06-20 | Accepted |
| [0007](./0007-migrations-over-synchronize.md) | Schema via migrations, never `synchronize` | 2026-06-20 | Accepted |
| [0008](./0008-redis-cache-ports.md) | Redis behind a minimal cache-store port; per-module caches by composition | 2026-06-20 | Accepted |
| [0009](./0009-scoped-repositories-as-guarded-factories.md) | Scoped repositories cross module boundaries as guarded factories | 2026-08-01 | Accepted |
| [0010](./0010-keyset-pagination.md) | Keyset pagination for transaction listings | 2026-08-15 | **Proposed** |
| [0011](./0011-cache-strategy.md) | Cache-aside at aggregate granularity, invalidated after commit | 2026-06-20 | Accepted |
| [0012](./0012-uow-port-hierarchy.md) | A three-level UoW port hierarchy, one impl per transactional boundary | 2026-06-20 | Accepted |
| [0013](./0013-period-sum-index.md) | No partial index for the period-sum query; the composite one already covers it | 2026-07-02 | Accepted |

## Where to start

If you only read two: **[0002](./0002-unit-of-work-pessimistic-locks.md)** is the
project's core engineering decision (why pessimistic locks instead of `SERIALIZABLE`),
and **[0009](./0009-scoped-repositories-as-guarded-factories.md)** is the one that
corrects an earlier ADR — it shows what changed and why 0003 was the wrong diagnosis.

They come in pairs. Read the second of each only if the first left you wanting the
mechanics:

| If you're changing… | Read | Then |
| --- | --- | --- |
| A transactional flow | [0002](./0002-unit-of-work-pessimistic-locks.md) — why locks | [0012](./0012-uow-port-hierarchy.md) — the port shape they live in |
| Anything cached | [0008](./0008-redis-cache-ports.md) — how it's wired | [0011](./0011-cache-strategy.md) — what's cached and who invalidates it |
| The schema | [0007](./0007-migrations-over-synchronize.md) — migrations, never `synchronize` | [0013](./0013-period-sum-index.md) · [0010](./0010-keyset-pagination.md) — the two index decisions |

**0003 is deliberately kept, not deleted.** A superseded ADR that records a mistake and
its correction is worth more than a clean record with the mistake edited out.

## Adding one

Copy [`0000-template.md`](./0000-template.md) to the next free number — **numbers are
permanent identifiers and are never reused or renumbered**, including for superseded
ADRs — fill it in, and add a row to the table above in the same PR.

Two ADRs are the short, linkable summary of a longer reference document that predates
them ([0008](./0008-redis-cache-ports.md) and [0011](./0011-cache-strategy.md) →
[`cache-decision.md`](../../src/shared/domain/cache-decision.md);
[0012](./0012-uow-port-hierarchy.md) →
[`uow-decision.md`](../../src/shared/domain/uow-decision.md)). If you change the decision,
change both — the ADR is the entry point, the reference document is the detail.
