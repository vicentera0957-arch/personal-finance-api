# Cache — design decisions

Reference document on how the cache system in this API is built, why **composition** was chosen over **inheritance** to connect the semantic caches to the transport, and why each abstraction is isolated in the layer that hosts it. If you touch the cache module, read this first.

> Convention: when the code and this doc disagree, the code wins — but open a PR to fix the doc in the same change.

---

## 1. Overall map

The system has **two** stacked layers, separated by a port at each level:

```
                          ┌─────────────────────────────────────────┐
   Semantic layer         │  IBudgetsCache                          │
   (what gets cached)     │  ICategoriesCache                       │  ports in
                          │  IUsersCache                            │  <module>/domain/ports/cache/
                          └────────────────────┬────────────────────┘
                                               │  has-a (constructor)
                                               ▼
                          ┌─────────────────────────────────────────┐
   Transport layer        │  ICacheStore                            │  port in
   (how it gets cached)   │  get / set / del / delByPrefix          │  shared/domain/cache/
                          └────────────────────┬────────────────────┘
                                               │  implements
                                               ▼
                          ┌─────────────────────────────────────────┐
                          │  RedisCacheStore (ioredis)              │  shared/infrastructure/cache/
                          └─────────────────────────────────────────┘
```

### Files

| Layer                 | File                                                                                   | Role                                                 |
|-----------------------|----------------------------------------------------------------------------------------|------------------------------------------------------|
| Transport (port)      | `src/shared/domain/cache/cache-store.port.ts`                                          | Generic key-value contract with TTL                  |
| Transport (impl)      | `src/shared/infrastructure/cache/redis-cache-store.ts`                                 | The only place that knows ioredis                    |
| Transport (module)    | `src/shared/infrastructure/cache/cache.module.ts`                                      | `@Global()`. Binds `ICacheStore` → `RedisCacheStore` |
| Semantic (port)       | `src/modules/<m>/domain/ports/cache/<m>-cache.port.ts`                                 | That aggregate's cache contract                      |
| Semantic (impl)       | `src/modules/<m>/infrastructure/cache/<m>-cache.impl.ts`                               | Maps entity ↔ shape and builds keys                  |
| Test double           | `src/modules/<m>/infrastructure/cache/__fakes__/null-<m>-cache.ts`                     | Null Object (no-ops) for tests/feature flags         |

`<m>` ∈ { budgets, categories, users } at the time of writing.

### Conventions

- **Keys:** `<module>:<scope>:<id>` (`budgets:item:<uuid>`, `categories:user:<uuid>:list`, `budgets:user:<uuid>:list:<year>-<month>`).
- **Global prefix:** `pf:` (configurable via `REDIS_KEY_PREFIX`). Applied by `RedisCacheStore`; module caches do NOT see the prefix.
- **TTL:** 600 s (10 min) by default in each impl. A constant local to each file, not shared — the duration is a semantic decision.
- **Serialization:** each impl declares an `interface XxxCacheShape` and two functions `toShape` / `fromShape`. `fromShape` rebuilds using `Entity.reconstitute(...)` and `VO.reconstitute(...)`, **never** `create(...)` — preserves timestamps and avoids re-validating persisted data (rule from `CLAUDE.md` §"Patterns that don't change").
- **Invalidation:** two modes:
  - Pinpoint `del(itemKey)` when there is only one key to clear.
  - `delByPrefix(...)` when there are N lists per user (the `budgets` case, where there is one list per `year-month` period).

---

## 2. Why there are two layers (what was abstracted and why)

The **only** place in the code that `import`s `ioredis` is `redis-cache-store.ts`. That restriction is not aesthetic — it pays off three concrete debts at once:

### 2.1. Dependency rule: the domain knows no vendors

The `*-cache.impl.ts` files live in `infrastructure/`, but their imports are all to domain abstractions (`ICacheStore`, the entity, its VOs). If each impl imported `ioredis`, the day Redis is swapped for KeyDB / Dragonfly / Memcached / an in-process cache you would have to touch **N files** (one per module). Today you touch **one**: `redis-cache-store.ts`. The number of change points is the honest metric of whether an abstraction earns its place.

### 2.2. The Redis connection is a resource, not a value

Redis is not "just another library". It is a stateful resource that must be **unique in the process**:

| Resource                           | Why it must be unique                                                |
|------------------------------------|-----------------------------------------------------------------------|
| TCP connection pool                | One pool per process, not one per module                              |
| Global `keyPrefix`                 | One source of truth for namespacing                                   |
| Retry policy                       | Homogeneous `maxRetriesPerRequest: 3` for a predictable SLO           |
| Lifecycle (`onModuleInit/Destroy`) | `ping` at startup, graceful `disconnect` at shutdown — once           |
| Metrics / tracing (future)         | Instrument the store once, every cache inherits observability         |

NestJS makes providers *singletons* by default, so `RedisCacheStore` is instantiated once and the module caches share that connection. Without the intermediate port, each `XxxCacheImpl` would do its own `new Redis(...)` and that guarantee would be lost.

### 2.3. Tests without Redis, without Docker, without a network

Any unit test of `BudgetsCacheImpl` mocks four methods:

```ts
const fakeStore: ICacheStore = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn(),
  del: jest.fn(),
  delByPrefix: jest.fn(),
};
const cache = new BudgetsCacheImpl(fakeStore);
```

No Redis running, no container, no surprises. And the `NullCategoriesCache` (`__fakes__/`) is trivial precisely because the **semantics** are decoupled from the **transport**: it implements the module's port with no-ops and that's it. Useful for "cache off" flags or tests that don't want any cache at all.

### 2.4. The port's surface is minimal and stable

```ts
// shared/domain/cache/cache-store.port.ts
export abstract class ICacheStore {
  abstract get<T>(key: string): Promise<T | null>;
  abstract set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  abstract del(key: string): Promise<void>;
  abstract delByPrefix(prefix: string): Promise<void>;
}
```

Four methods. It is the minimal contract that **any** key-value cache supports: Redis, Memcached, a `Map` with in-memory expiration, a metrics decorator, a two-tier (in-process L1 + distributed L2). It leaks no Redis-only primitives (`MULTI`, `EVAL`, `SUBSCRIBE`, `XADD`) — and that is intentional: no module's semantic cache should need them. If one day one does, that case is a different port, not this one.

> **Heuristic rule for evaluating ports:** a port is justified when the abstraction's surface is **smaller and more stable** than the concrete's surface. `ICacheStore` has 4 methods; `ioredis` exports hundreds. The difference is the stability promise.

---

## 3. Why composition, not inheritance

> The natural question when reading the code is: *if `ICacheStore` already exists in `shared/domain/`, why doesn't `IBudgetsCache` `extends ICacheStore`, the way `IBudgetUnitOfWork extends IUnitOfWork` does?*

The short answer: because the **semantic relationship is different**. UoW is specialization ("is-a"); cache is collaboration ("has-a"). What follows is the rigorous version.

### 3.1. The decisive test — who calls the shared port's methods?

| Shared port       | Who invokes it?                                              | Result      |
|-------------------|--------------------------------------------------------------|-------------|
| `IUnitOfWork`     | The **use case** (`uow.begin()`, `uow.commit()`, ...)        | Inheritance |
| `ICacheStore`     | **Only the cache impl** (`this.store.get(...)`). The use case never sees it. | Composition |

The use case that receives `IBudgetUnitOfWork` **needs** to call `begin/commit/rollback`. The use case that receives `IBudgetsCache` must **not** call `get('some-raw-key')` — it must call `getListByUser(userId, options)`. The low-level API is the impl's private property.

Inheritance **exposes**; composition **hides**. For UoW we want to expose. For cache we want to hide.

### 3.2. UoW — the lifecycle IS part of the public API

```ts
// shared/domain/IUnitOfWork.ts
export abstract class IUnitOfWork {
  abstract begin(): Promise<void>;
  abstract commit(): Promise<void>;
  abstract rollback(): Promise<void>;
  abstract release(): Promise<void>;
  abstract isActive(): boolean;
}

// modules/budgets/domain/IBudgetUnitOfWork.ts
export abstract class IBudgetUnitOfWork extends IUnitOfWork {
  abstract getBudgetRepository(): IBudgetRepository;
  abstract getScopedExpenseChecker(): IExpenseChecker;
}
```

The use case literally orchestrates the lifecycle:

```ts
await uow.begin();
try {
  const repo = uow.getBudgetRepository();   // module-specific contribution
  // ...
  await uow.commit();
} catch (e) {
  await uow.rollback();
  throw e;
} finally {
  await uow.release();
}
```

`begin/commit/rollback` **don't change across modules**. They are universal. The only thing the module adds is typed getters to its repos. The subclass **specializes without replacing**. That is exactly what inheritance models well.

### 3.3. Cache — the transport is NOT part of the public API

```ts
// modules/budgets/domain/ports/cache/budgets-cache.port.ts
export abstract class IBudgetsCache {
  abstract getListByUser(userId: string, options?: BudgetQueryOptions): Promise<Budget[] | null>;
  abstract setListByUser(...): Promise<void>;
  abstract getById(id: string): Promise<Budget | null>;
  abstract setById(budget: Budget): Promise<void>;
  abstract invalidateUser(userId: string): Promise<void>;
  abstract invalidateById(id: string): Promise<void>;
}
```

These methods speak of `Budget`, of `userId`, of "invalidating the user". The use case should never build a Redis key by hand. If we made `IBudgetsCache extends ICacheStore`:

```ts
class GetBudgetsByUserUseCase {
  constructor(private cache: IBudgetsCache) {}
  async execute(userId: string) {
    return this.cache.getListByUser(userId);     // semantic — correct

    // but this would ALSO compile:
    return this.cache.get('anything');           // wrong
    await this.cache.delByPrefix('budgets:');    // wrong — breaks invariants
    await this.cache.set('my-key', x, 5);        // wrong — TTL out of control
  }
}
```

That is a **leaky abstraction** guaranteed by construction. Composition closes it: the only references to `ICacheStore` live inside `BudgetsCacheImpl`. The use case cannot even mention `get('...')` — the type doesn't expose it. This is the **Interface Segregation Principle** applied strictly.

### 3.4. Liskov — both satisfy it formally, but only one semantically

- **`IBudgetUnitOfWork` "is-a" `IUnitOfWork`**: true. A generic tracing middleware measuring time between `begin` and `commit` would work with either. The specialization adds capabilities without altering the existing ones.
- **`IBudgetsCache` "is-a" `ICacheStore`**: false. Does an `IBudgetsCache` with `get('foo')` return a `Budget`? Anything at all? The signatures are incompatible at the level of intent (`get<T>(key)` vs things typed to `Budget`). The budgets cache *uses* a store; it *is not* one.

This is the rigorous version of the colloquial "is-a vs has-a".

### 3.5. Cardinality — UoW is 1:1, cache is N:1

**UoW.** One concrete class implements several module ports via `useExisting` because they share the same request-scoped `QueryRunner`:

```ts
{ provide: TypeOrmUnitOfWorkImpl,  useClass: TypeOrmUnitOfWorkImpl, scope: Scope.REQUEST }
{ provide: ITransactionUnitOfWork, useExisting: TypeOrmUnitOfWorkImpl }
{ provide: IBudgetUnitOfWork,      useExisting: TypeOrmUnitOfWorkImpl }
{ provide: IAccountUnitOfWork,     useExisting: TypeOrmUnitOfWorkImpl }
```

Multiple contract inheritance models exactly this: **different typed views over the same transactional resource**.

**Cache.** A single resource (`RedisCacheStore`) serves N semantic caches:

```ts
{ provide: ICacheStore,      useExisting: RedisCacheStore }      // 1 Redis client
{ provide: IBudgetsCache,    useClass: BudgetsCacheImpl }
{ provide: ICategoriesCache, useClass: CategoriesCacheImpl }
{ provide: IUsersCache,      useClass: UsersCacheImpl }
```

If `IBudgetsCache extends ICacheStore`, each `XxxCacheImpl` would become *an* `ICacheStore` and the DI graph would turn ambiguous (which one resolves when `ICacheStore` is requested?). Composition removes the ambiguity: there is exactly **one** `ICacheStore` in the container, and the semantic caches consume it without taking part in its contract.

### 3.6. What each choice enables going forward

**Inheritance (UoW)** lets you add a new transactional module by creating a new port that extends `IUnitOfWork` with its getters, and having `TypeOrmUnitOfWorkImpl` (or a new impl) satisfy it. The new module's use case receives exactly the surface it needs.

**Composition (cache)** enables **decorators** (metrics, logs, two-tier L1+L2, circuit breaker) without touching any module cache:

```ts
{ provide: ICacheStore, useFactory: (redis, metrics) =>
    new MetricsCacheStore(new TwoTierCacheStore(new InMemoryStore(), redis), metrics) }
```

Zero changes in `BudgetsCacheImpl`, `CategoriesCacheImpl`, `UsersCacheImpl`. Had they inherited, decorating would require touching each module cache individually.

---

## 4. Decision table — when to extend a shared port and when to compose it

When in doubt between `extends SharedPort` and `constructor(private dep: SharedPort)`:

| Question                                                                                  | "Yes" implies       |
|--------------------------------------------------------------------------------------------|--------------------|
| Does the consumer of the module port need to call the shared port's methods?               | **extends**        |
| Are the shared port's methods universal and called *the same way* in every module?         | **extends**        |
| Are the shared port's methods low-level primitives the module encapsulates?                | **composition**    |
| Are there N module ports sharing *one* instance of the shared resource?                    | **composition**    |

- **UoW:** yes, yes, no, no → **inheritance**.
- **Cache:** no, no, yes, yes → **composition**.

---

## 5. Rules for anyone touching the module

- Do **not** import `ioredis` outside `redis-cache-store.ts`. If you need a new primitive, add it to `ICacheStore` (and the impl), don't call it from a module cache.
- Do **not** use `ICacheStore` directly from a use case. Go through the semantic port (`IBudgetsCache`, etc.) or create a new one if the case warrants it.
- Do **not** call `Entity.create()` or `VO.create()` inside `fromShape`. Always use `reconstitute(...)` — the persisted data was already validated in its day.
- Do **not** mix keys across modules. Each module's prefix (`budgets:`, `categories:`, `users:`) is that module's property; don't build them from elsewhere.
- Do **not** depend on the global `pf:` prefix inside the semantic caches. `RedisCacheStore` applies it; working against it breaks the invariant that only one file knows the namespacing.
- Do **not** raise the TTL without a documented reason. Today it is 600 s in all three impls; if you change one, write the why in the commit and consider whether the others should move too.
- **Do** add a cache port for a new module by replicating the template: port in `<module>/domain/ports/cache/`, impl in `<module>/infrastructure/cache/`, null object in `__fakes__/`. Binding in the module's `Module`.

---

## 6. One-sentence summary

> **Inherit to specialize contracts (`IBudgetUnitOfWork extends IUnitOfWork`); compose to reuse behavior (`BudgetsCacheImpl` receives `ICacheStore`).**

In this repo, inheritance is reserved for contracts whose full surface **must be visible** to the consumer of the module port. Composition is applied when what is being reused is a resource or primitive that **must remain hidden** behind a higher-level semantic API. That distinction is what keeps the project's layers livable in the long run.
