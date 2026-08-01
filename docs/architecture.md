# Architecture

This is the technical entry point. It explains the layering, the module graph, and
how a money-mutating request flows through the system. For the _why_ behind specific
choices, see the [ADRs](./adr/). For the concurrency deep-dive, see
[`concurrency-model.md`](./concurrency-model.md).

## 1. Layering (DDD / Clean)

Every module has the same three-layer skeleton. Dependencies point **inward**: the
domain knows no one; application knows the domain; infrastructure knows both. The
domain never imports NestJS, TypeORM, or HTTP.

```mermaid
flowchart LR
    subgraph Infrastructure
        HTTP["Controllers / DTOs"]
        PERS["Repo impls / UoW / mappers"]
        ADP["Adapters: bcrypt · JWT · Redis"]
    end
    subgraph Application
        UC["Use cases"]
        SCH["Schedulers"]
    end
    subgraph Domain
        ENT["Entities + Value Objects"]
        PORT["Ports: repository / UoW / cache"]
        EXC["Domain exceptions"]
    end

    HTTP --> UC
    UC --> ENT
    UC --> PORT
    PERS -. implements .-> PORT
    HTTP -. maps .-> EXC
    PERS --> DB[("PostgreSQL")]
    ADP --> REDIS[("Redis")]
```

- **Domain** — pure: rich entities with private constructors and `create()` /
  `reconstitute()` factories, immutable self-validating value objects, ports as
  `abstract class` ([ADR-0001](./adr/0001-ports-as-abstract-classes.md)), and plain
  `Error` subclasses ([ADR-0006](./adr/0006-domain-exceptions-vs-http.md)).
- **Application** — one class per use case with a single `execute()`; `@Cron`
  schedulers (auth token cleanup today).
- **Infrastructure** — TypeORM entities + mappers + repository implementations, the
  Unit of Work, HTTP controllers/DTOs, and external adapters (incl. the only Redis client).

## 2. Module graph

Module-to-module dependencies, taken from each module's NestJS `imports`. A **solid**
edge is a direct import; a **dashed** edge is a `forwardRef()` that closes a dependency
cycle. `users`, `categories` and `accounts` are leaves (they import no other domain module).

```mermaid
graph TD
    auth["auth"] -->|imports| users["users"]

    transactions["transactions"] --> accounts["accounts"]
    transactions --> categories["categories"]
    transactions --> budgets["budgets"]
    budgets --> categories

    budgets -. forwardRef .-> transactions

    linkStyle 5 stroke:#d39e00,stroke-width:2px;
```

One cycle remains, `budgets ↔ transactions`, and it is deliberate: `transactions`
imports `budgets` to check budgets, and `budgets` needs `IBudgetUnitOfWork` and
`IExpenseChecker`, which `transactions` implements. That reverse direction is handled
by the **port-owned-by-consumer** pattern (§2.1), not by a raw import of transactions'
internals.

The `accounts ↔ transactions` cycle **is gone**. It never carried domain meaning: it
existed only because the provider for `IAccountUnitOfWork` was declared in
`transactions.module.ts`, a token `transactions` never injected. `accounts` now owns
`AccountUnitOfWorkImpl` and is a leaf; `transactions → accounts` remains, one-way (§2.2).

| Module | Responsibility |
| --- | --- |
| **auth** | Register, login, refresh (rotation + replay detection), logout. Global JWT guard with `@Public()` opt-out. Throttled 5/min. |
| **users** | User CRUD + bcrypt. Owns only its own profile. |
| **accounts** | Balance, account type; inflow/outflow/archive/unarchive. Archived accounts are read-only. |
| **categories** | `income`/`expense` nature (immutable). Budgetability derived from nature. |
| **budgets** | One budget per (user, category, month, year). Limit enforcement. |
| **transactions** | Immutable, single-entry records ([ADR-0005](./adr/0005-single-entry-immutable-transactions.md)). All creates/deletes run inside a Unit of Work. |

### 2.1 Port owned by consumer — how `budgets` depends on `transactions`

`budgets` needs to ask `transactions` a question — *"are there expenses in this period,
and how much?"* — to enforce its rules (`DeleteBudget`, `UpdateBudgetLimit`). But
`transactions` already imports `budgets`. A direct call back would be a hard cycle.

The fix: the **port is defined in the consumer's domain (`budgets`)**, and the
**implementation lives in the provider (`transactions`)**. So the compile-time
dependency points `transactions → budgets` (the impl imports the port), while the
runtime call points `budgets → transactions` (the use case calls the impl that DI
injected). `forwardRef()` lets NestJS wire the cycle. See
[ADR-0003](./adr/0003-port-owned-by-consumer.md).

```mermaid
flowchart LR
    subgraph budgets["budgets module"]
        direction TB
        BUC["DeleteBudget · UpdateBudgetLimit<br/><i>use cases — the consumer</i>"]
        IEC["«port» IExpenseChecker<br/><i>defined in budgets/domain</i>"]
        BUC -->|"calls at runtime"| IEC
    end

    subgraph transactions["transactions module"]
        direction TB
        ECI["«impl» ScopedExpenseChecker<br/><i>transactions/infrastructure (UoW)</i>"]
        TR["TransactionRepository<br/>SUM expenses in period"]
        ECI -->|uses| TR
    end

    ECI -.->|"implements (compile-time dep: transactions → budgets)"| IEC

    classDef port fill:#fff3cd,stroke:#d39e00,color:#222;
    classDef impl fill:#d1e7dd,stroke:#0f5132,color:#222;
    class IEC port
    class ECI impl
```

> Read it as: **budgets owns the contract, transactions fulfils it.** At runtime the
> arrow you "feel" is `budgets → transactions`; at compile time the source arrow is the
> reverse (`transactions → budgets`). That inversion is the whole point — it keeps the
> domain dependency one-way while letting the two modules collaborate.

The **same shape** is used once more, implemented by `transactions`:

| Port (contract) | Owned by (domain) | Implemented by | Consumed by |
| --- | --- | --- | --- |
| `IExpenseChecker` | `budgets` | `transactions` (`ScopedExpenseChecker`, in the UoW) | `DeleteBudget`, `UpdateBudgetLimit` |
| `IBudgetUnitOfWork` | `budgets` | `transactions` (`TypeOrmUnitOfWorkImpl`) | `UpdateBudgetLimit`, `DeleteBudget` |
| `IAccountUnitOfWork` | `accounts` | **`accounts`** (`AccountUnitOfWorkImpl`) | `Archive`, `Unarchive`, `Rename` |

### 2.2 Why `accounts` does **not** depend on `transactions`

`accounts` has three state-changing operations — `archive`, `unarchive`, `rename` — that
must serialize against a transaction mutating the **same account row**. The sharp case:
archiving an account is a TOCTOU race with a concurrent `POST /transactions` ("Race 2").
Archived accounts are read-only, so if `archive` commits while a `CreateTransaction` has
already read the account as *active*, the transaction would be applied to an account that
is now archived — invariant violated.

The serialization point is the **account-row lock** (`SELECT ... FOR UPDATE`). This module
originally received `IAccountUnitOfWork` from `transactions`, on the belief that competing
for the *same* lock required the *same* UoW instance. That belief was wrong, and it was
what closed the cycle.

`Scope.REQUEST` already means **one instance per request**: an `archive` request and a
`POST /transactions` request always had distinct instances, distinct `QueryRunner`s and
distinct DB transactions. What serializes them is Postgres holding the row lock until
commit — visible to any concurrent transaction, on any connection. Sharing the class never
entered into it.

So `accounts` implements its own `AccountUnitOfWorkImpl` and imports nothing. The single
`ScopedAccountRepository` — with the `FOR UPDATE` — lives in `accounts/infrastructure` and
is reached through a factory that takes a `QueryRunner`; `transactions` composes it on its
own runner for the multi-aggregate boundary. One arrow remains, `transactions → accounts`,
and it carries real domain weight.

```mermaid
flowchart LR
    subgraph accounts["accounts module"]
        direction TB
        AUC["Archive · Unarchive · Rename<br/><i>use cases</i>"]
        IAU["«port» IAccountUnitOfWork<br/><i>accounts/domain</i>"]
        UOW["«impl» AccountUnitOfWorkImpl<br/><i>accounts/infrastructure</i>"]
        LOCK["ScopedAccountRepository.findById<br/>SELECT … FOR UPDATE (account row)"]
        AUC -->|"calls at runtime"| IAU
        UOW -.->|implements| IAU
        UOW -->|"factory (QueryRunner)"| LOCK
    end

    subgraph transactions["transactions module"]
        direction TB
        TUOW["«impl» TypeOrmUnitOfWorkImpl<br/><i>transactions/infrastructure</i>"]
    end

    TUOW -->|"same factory, its own QueryRunner<br/>(compile-time dep: transactions → accounts)"| LOCK

    classDef port fill:#fff3cd,stroke:#d39e00,color:#222;
    classDef impl fill:#d1e7dd,stroke:#0f5132,color:#222;
    class IAU port
    class UOW impl
```

## 3. Concurrency: how a transaction is created safely

Cross-aggregate, money-touching invariants run inside a request-scoped Unit of Work
(one `QueryRunner` = one PostgreSQL transaction) and use `SELECT ... FOR UPDATE` to
serialize. The budget row is the **logical mutex** for the "Σ period expenses ≤ limit"
invariant. Full rationale: [ADR-0002](./adr/0002-unit-of-work-pessimistic-locks.md)
and [`concurrency-model.md`](./concurrency-model.md).

```mermaid
sequenceDiagram
    participant UC as CreateTransactionUseCase
    participant UoW as Unit of Work
    participant PG as PostgreSQL

    UC->>UoW: begin() (dedicated QueryRunner)
    UC->>PG: find budget row  ── FOR UPDATE (logical mutex)
    UC->>PG: SUM(expenses in period)  ── no lock, serialized by the row above
    note over UC: reject if projected spend > limit
    UC->>PG: find account row  ── FOR UPDATE
    UC->>PG: update balance (inflow / outflow)
    UC->>PG: insert transaction
    UC->>UoW: commit()
```

## 4. Caching & Redis

Redis serves two jobs: the **cache** and the **throttler storage** (so per-IP limits
hold across instances). The domain stays vendor-agnostic via two stacked ports:
per-module **semantic** caches (`IBudgetsCache`, …) that *compose* a minimal transport
port `ICacheStore`, whose single adapter `RedisCacheStore` is the only file that imports
`ioredis`. Use cases never touch the transport directly. Full rationale:
[ADR-0008](./adr/0008-redis-cache-ports.md) and
[`cache-decision.md`](../src/shared/domain/cache-decision.md).

```mermaid
flowchart TB
    UC["Module use cases"]
    IBC["IBudgetsCache"]
    ICC["ICategoriesCache"]
    IUC["IUsersCache"]
    ICS["«port» ICacheStore<br/>get · set · del · delByPrefix · ping"]
    RCS["«impl» RedisCacheStore<br/><i>only file importing ioredis</i>"]
    THR["Global ThrottlerGuard<br/>(Redis storage)"]
    REDIS[("Redis")]

    UC --> IBC & ICC & IUC
    IBC & ICC & IUC -->|"composition (has-a)"| ICS
    ICS -->|"bound to"| RCS
    RCS --> REDIS
    THR --> REDIS

    classDef port fill:#fff3cd,stroke:#d39e00,color:#222;
    classDef impl fill:#d1e7dd,stroke:#0f5132,color:#222;
    class ICS port
    class RCS impl
```

## 5. Cross-cutting infrastructure

- **AuthN/Z** — JWT access + DB-backed rotating refresh tokens
  ([ADR-0004](./adr/0004-refresh-token-rotation.md)); actor read from
  `@CurrentUser()`, never from body/URL.
- **Validation** — `class-validator` DTOs at the HTTP edge; `joi` validates env at
  boot (fail-fast on missing prod secrets).
- **Resilience/ops** — Redis-backed throttling, Prometheus metrics (`/metrics`),
  structured logging (pino), liveness (`/health`) and readiness (`/ready`) probes.
- **Schema** — migrations only ([ADR-0007](./adr/0007-migrations-over-synchronize.md)).

## 6. Where to read more

| Topic | Doc |
| --- | --- |
| Design decisions (the _why_) | [`adr/`](./adr/) |
| Concurrency model & lock map | [`concurrency-model.md`](./concurrency-model.md) |
| Cache design (composition vs inheritance) | [`cache-decision.md`](../src/shared/domain/cache-decision.md) |
| Deployment (build → release → run) | [`deployment.md`](./deployment.md) |