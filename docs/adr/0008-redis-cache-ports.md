# ADR-0008: Redis behind a minimal cache-store port; per-module caches by composition

- **Status:** Accepted <!-- rationale already written up in src/shared/domain/cache-decision.md -->
- **Date:** YYYY-MM-DD
- **Deciders:** Vicente Cristobal Rivas Avello

> The full, rigorous rationale lives in
> [`src/shared/domain/cache-decision.md`](../../src/shared/domain/cache-decision.md).
> This ADR is the short, linkable summary.

## Context and problem statement

Read-heavy aggregates (budgets, categories, users) benefit from caching, and the
global rate-limiter needs shared storage so per-IP limits hold across instances. Both
land on **Redis**. The risk: leaking a vendor (`ioredis`) and its low-level primitives
(`get`, `set`, `MULTI`, `EVAL`) into the domain and use cases, which would couple
business logic to the transport and make tests require a live Redis.

> Facts from the code:
> - [`ICacheStore`](../../src/shared/domain/cache/cache-store.port.ts) — a 5-method
>   transport port (`get`/`set`/`del`/`delByPrefix`/`ping`).
> - [`RedisCacheStore`](../../src/shared/infrastructure/cache/redis-cache-store.ts) — the
>   **only** file that imports `ioredis`; a `@Global()` module binds the port to it.
> - Per-module **semantic** cache ports (`IBudgetsCache`, `ICategoriesCache`,
>   `IUsersCache`) that **compose** `ICacheStore` (constructor dependency), not inherit it.
> - The throttler uses `@nest-lab/throttler-storage-redis`; readiness (`/ready`) calls
>   `ICacheStore.ping()` and treats Redis as a hard dependency.

## Decision

One minimal transport port (`ICacheStore`) with a single Redis adapter; module caches
are **semantic ports composed on top** of it, never subclasses of it. Redis is a single
shared resource (one client/pool) and a hard runtime dependency surfaced in readiness.

## Why this option

Distilled from `cache-decision.md`:

- **Vendor isolation** — swapping Redis (KeyDB/Dragonfly/in-memory) touches **one** file.
- **Resource uniqueness** — one connection pool, one `keyPrefix`, one retry policy,
  one lifecycle (`onModuleInit` ping / `onModuleDestroy` disconnect).
- **Composition hides primitives (ISP)** — a use case holding `IBudgetsCache` can call
  `getListByUser(...)` but *cannot* call raw `get('key')` / `delByPrefix(...)`; the type
  doesn't expose them. Inheritance would leak them.
- **Testability** — unit tests fake 4 methods; no Redis, no Docker, no network.

## Alternatives considered

- **`IBudgetsCache extends ICacheStore` (inheritance):** rejected — leaks transport
  primitives to consumers and makes the DI graph ambiguous (every module cache would
  *be-a* `ICacheStore`). See `cache-decision.md` §3.
- **Import `ioredis` directly in each module cache:** rejected — N change points, N
  Redis connections, no shared lifecycle.
- **In-process cache (no Redis):** rejected — doesn't survive multiple instances and
  can't back cross-instance rate limiting.

## Consequences

**Positive**

- Backend swap and cross-cutting decorators (metrics, two-tier L1+L2, circuit breaker)
  without touching any module cache.
- Domain stays vendor-agnostic; caches are trivially unit-testable.

**Negative / trade-offs**

- Redis is a **hard** runtime dependency: if it's down, `/ready` returns 503 and the
  throttler rejects. Conscious choice (documented in
  [`production-readiness`](../history/production-readiness-2026-06-16.md) §3).

**Follow-ups**

- Related: [ADR-0001](./0001-ports-as-abstract-classes.md) (ports as abstract classes).
