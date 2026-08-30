# ADR-0011: Cache-aside at aggregate granularity, invalidated after commit

- **Status:** Accepted
- **Date:** 2026-06-20 · recorded as an ADR 2026-08-30
- **Deciders:** Vicente Cristobal Rivas Avello

> [ADR-0008](./0008-redis-cache-ports.md) settles **how** the cache is wired (one
> transport port, per-module semantic ports by composition). This ADR settles **what**
> gets cached, **when** it is written, and **who** invalidates it.
> The full, rigorous rationale for both lives in
> [`src/shared/domain/cache-decision.md`](../../src/shared/domain/cache-decision.md).

## Context and problem statement

Three aggregates are read far more often than they are written: `budgets` (re-read on
every expense to check the limit), `categories` (a per-user list that changes rarely) and
`users` (re-read on every authenticated request). Caching them is worth it. Deciding to
cache, however, is not one decision but four, and each has a wrong answer that is easy to
reach by accident:

- **Granularity.** Cache query results, or cache the aggregate?
- **Write policy.** Does a write go to Redis and Postgres, or only to Postgres?
- **Freshness.** How long may a stale read live?
- **Invalidation.** Who clears the key, and — the one that actually bites — *when*,
  relative to the database transaction that made the key stale.

The last one is where the money is. Every write that has to hold an invariant across
aggregates runs inside a Unit of Work
([ADR-0002](./0002-unit-of-work-pessimistic-locks.md)) — which puts the cache call and a
database transaction in the same method, and the order matters. If invalidation runs
**inside** `uow.run(...)`, a Redis timeout throws inside the transactional callback and
rolls back a business operation that was otherwise correct; and if the transaction later
rolls back for its own reasons, the cache was cleared for a write that never happened.

## Decision

We will use **cache-aside (lazy read-through) at aggregate granularity**, with:

- **Reads** — the use case asks its semantic port first; on a miss it goes to the
  repository and writes the result back (`getById` → miss → repo → `setById`).
- **Writes** — the database is the only write path. Nothing is written to Redis on the
  write side; the next read repopulates.
- **TTL** — `600` seconds, declared as a `TTL_SECONDS` constant **local to each impl**
  (`budgets-cache.impl.ts:8`, and the same in `categories`/`users`), not shared.
- **Keys** — `<module>:<scope>:<id>`, under the global `pf:` prefix that only
  `RedisCacheStore` knows about (`budgets:item:<uuid>`,
  `budgets:user:<uuid>:list:<year>-<month>`, `categories:user:<uuid>:list`). Where one
  user owns N lists, invalidation is `delByPrefix`; where there is one key, it is `del`.
- **Invalidation** — explicit, and always **after** the write is persisted. In a
  UoW-backed use case that means after `await uow.run(...)` has resolved, in its own
  `try/catch` that only `Logger.warn`s, so a Redis failure never propagates and never
  rolls back (`delete-budget.use-case.ts:54-66`, `update-budget-limit.use-case.ts`).
  Where no transaction is involved (`create-budget`, `categories`, `users`) it is a
  plain post-write call.
- **Cache-off** — each module ships a Null Object (`__fakes__/null-<m>-cache.ts`) that
  satisfies the port with no-ops, so "no cache" is a binding change, not a code change.

## Why this option

**Because a commit is durable, and nothing that happens afterwards can un-succeed it.**
That single sentence decides the invalidation placement. Once Postgres has committed, the
budget *is* deleted; a Redis failure at that point is a stale-cache problem bounded by the
TTL, not a correctness problem, and turning it into a 500 would be reporting a failure
that did not occur. `delete-budget.use-case.ts:54-66` is the reference shape, and its
comment block is the argument in situ.

Under the stateless UoW runner ([ADR-0012](./0012-uow-port-hierarchy.md)) this stopped
being a discipline and became a property of the types: the `try` that a rollback lives in
is private to `TypeOrmTransactionRunner.run()`, so there is no surface left inside it for
a use case to hang cache work on.

**Cache-aside over write-through** because write-through buys freshness by adding a second
write path that has to be kept correct forever — and it is only *actually* fresh if the
Redis write and the Postgres commit are atomic, which they are not. Cache-aside has one
source of truth and one failure mode (a stale read, bounded by the TTL).

**Aggregate granularity over query-result caching** because an aggregate has an identity,
so it has an obvious invalidation key. A cached arbitrary query has no owner: nothing in
the write path knows which of N cached result sets a given `UPDATE` invalidated, and the
usual escape hatch — flush everything on any write — throws away the hit rate the cache
was bought for.

**TTL as a per-impl constant** because the tolerable staleness of a budget is a statement
about budgets, not about Redis. A shared `CACHE_TTL` would invite one module's freshness
requirement to silently set another's.

**A `600` s TTL** because it is a backstop, not the primary mechanism. Correctness comes
from explicit invalidation; the TTL exists to bound the damage from the invalidation that
was skipped, lost, or written for a key that no longer matches.

## Alternatives considered

- **Option A — write-through / write-behind:** rejected. Two write paths, no atomicity
  with the commit, and write-behind adds a durability question the DB had already
  answered.
- **Option B — invalidate inside `uow.run(...)`:** rejected. Couples a business
  transaction's success to Redis availability, and clears keys for writes that may still
  roll back. This is P7 in
  [`history/structural-refactors.md`](../history/structural-refactors.md).
- **Option C — cache query results instead of aggregates:** rejected. No stable
  invalidation key; degenerates into flushing by prefix on every write.
- **Option D — TTL only, no explicit invalidation:** rejected. Simple, but it makes every
  write visible only after up to 10 minutes — unacceptable for a budget limit the user
  just changed.
- **Option E — one shared TTL constant:** rejected. See above; the duration is a semantic
  decision per aggregate.

## Consequences

**Positive**

- One write path. Postgres stays the single source of truth, so a cache bug can only ever
  cost freshness, never data.
- Redis being slow or down degrades reads; it cannot fail a write.
- Turning the cache off per module is a one-line binding swap to the Null Object.
- Unit tests need four fake methods and no Redis (see ADR-0008).

**Negative / trade-offs**

- **Reads can be stale for up to 600 s** when an invalidation is missed. Accepted
  deliberately; the alternative is coupling writes to Redis.
- Every new write path has to remember to invalidate. This is a convention the compiler
  cannot enforce — the mitigation is the TTL and the rule list in
  [`cache-decision.md`](../../src/shared/domain/cache-decision.md) §5.
- The first read after any write always misses.
- `delByPrefix` on the budgets list keys is O(matched keys); fine at this cardinality
  (one user's periods), and worth re-checking if list keys ever fan out further.

**Follow-ups**

- **The guard is not applied uniformly.** Only the two UoW-backed budget use cases wrap
  invalidation in a `try/catch`. `create-budget`, `create-category`, `delete-category`,
  `delete-user` and `update-user-profile` call `invalidate*` unguarded after the write has
  already been persisted, so a Redis failure there surfaces to the caller as a 500 for an
  operation that in fact succeeded — the exact failure mode the budget pattern exists to
  prevent. Worth closing; it is a five-line change per use case, not a design question.
- Related: [ADR-0008](./0008-redis-cache-ports.md) (the ports),
  [ADR-0002](./0002-unit-of-work-pessimistic-locks.md) (why invalidation has a "after
  what" at all).
- Cache hit/miss ratio is not exported to Prometheus yet; a `MetricsCacheStore` decorator
  would add it without touching any module cache
  ([`observability.md`](../observability.md)).
