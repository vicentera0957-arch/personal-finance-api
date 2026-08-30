# Concurrency model

- **Last updated:** 2026-08-30

> Reference and study document. Gathers in one place what is fragmented across
> [CLAUDE.md](../CLAUDE.md) (the authoritative lock map), [uow-decision.md](../src/shared/domain/uow-decision.md)
> (the pattern), [race-conditions-fix-2026-05.md](./history/race-conditions-fix-2026-05.md) (cross-module
> post-mortems) and each module's `notes.md`. When the code and this doc disagree, the code
> wins — but open a PR to fix the doc.

---

## The model in one sentence

**Strong consistency on writes (targeted pessimistic locks), relaxed consistency on
reads (benign stale reads).** The coordination cost is paid only where a mistake costs money;
whatever is merely displayed stays cheap.

---

## 1. Isolation level

**`READ COMMITTED`** — PostgreSQL's default. The system does **not** raise it to `REPEATABLE READ` or
`SERIALIZABLE`. This is a decision, not an oversight:

- `SERIALIZABLE` would detect conflicts at commit time and abort with `40001` — but it would force
  the application to implement **retries**.
- Instead, the system **manufactures serialization where it needs it** with explicit pessimistic
  locks on specific rows. It doesn't ask Postgres for global isolation; it builds it point by point.

Expected consequence of `READ COMMITTED`: within the same tx, two reads of the same row can
see different values (*non-repeatable reads*) and *phantoms* appear (new rows in a range). The
design neutralizes this by funneling every writer through a guardian row, not by raising the isolation level.

---

## 2. The two mechanisms

| Concurrency problem | Mechanism | Where it lives |
| --- | --- | --- |
| **read-modify-write** (lost update, write skew) | `SELECT … FOR UPDATE` (pessimistic row lock) | scoped repos, inside the UoW |
| **check-then-insert** (duplicates) | unique constraint + `catch 23505` → domain exception | global repos (`save()`) |

Mental rule: **read-modify-write → lock. check-then-insert → constraint.** Never the other way
around — you cannot lock a row that doesn't exist yet, so uniqueness is guaranteed by the DB, not by a lock.

The pessimistic lock is taken when the row is **read** and is **held until `COMMIT`/`ROLLBACK`**
(two-phase locking) — not until the query returns. That is what covers the subsequent write:
between the `findByIdWithLock` and the `commit`, the row is locked for everyone else.

> That is why the scoped repos run on the `QueryRunner`'s `manager` (open tx) and **not** on the
> global `DataSource` (autocommit). In autocommit the `FOR UPDATE` would be released as soon as the SELECT
> finishes and would be useless. See the anti-pattern in CLAUDE.md: *"Do not read inside an open UoW with the global repository."*

---

## 3. The transactional boundary — Unit of Work

> **Updated after `docs/history/structural-refactors.md` (P3+P4).** The UoW used to be a stateful
> object (`begin`/`commit`/`rollback`/`release`/`isConnected`, a mutable `QueryRunner` field,
> `Scope.REQUEST` on every provider). It is now a stateless runner: one method, `run<T>(work)`, with
> the `QueryRunner` living on the call stack of that call instead of in a field. Every UoW provider
> is a plain singleton. What follows describes the current shape; the historical `useExisting` /
> `Scope.REQUEST` discussion is kept because the same reasoning about *what sharing an instance does
> and doesn't buy* still applies — it just applies to `run()` calls now, not to request-scoped
> instances.

**Four** concrete implementations, separated by **atomic operation**, not by module — a 1:1 mapping
onto the four module-specific ports. Each `extends TypeOrmTransactionRunner<TCtx>`
(`shared/infrastructure/persistence/typeorm-transaction-runner.ts`, which owns the entire lifecycle:
create `QueryRunner` → connect → start transaction → build `TCtx` via `createContext()` → run the
callback → commit/rollback → release) and separately `implements I<Module>UnitOfWork` (valid because
that port declares nothing beyond the inherited `run()`):

- **`TypeOrmUnitOfWorkImpl`** (`transactions/infrastructure/persistence/unit-of-work.impl.ts`) —
  satisfies `ITransactionUnitOfWork` only. Every `run()` call opens its own `QueryRunner` → one PG
  transaction, which `CreateTransaction` needs because it writes three aggregates at once. It used
  to also satisfy `IBudgetUnitOfWork` via `useExisting` (and, earlier, `IAccountUnitOfWork`); see
  below for why that stopped.
- **`BudgetUnitOfWorkImpl`** (`budgets/infrastructure/`) — separate: `UpdateBudgetLimit` and
  `DeleteBudget` touch only the budget aggregate (+ one aggregate expense read).
- **`AccountUnitOfWorkImpl`** (`accounts/infrastructure/`) — separate: `Archive`, `Unarchive` and
  `Rename` touch only the account aggregate.
- **`AuthUnitOfWorkImpl`** (`auth/infrastructure/`) — separate: refresh-token rotation shares no
  invariant with the financial aggregates.

`transactions` keeps the multi-aggregate impl because **every multi-aggregate invariant in the
domain is anchored to a `Transaction` mutation** (balance, limit, period sum). Every *single*-aggregate
invariant now has its own dedicated impl, in its own module.

**What `useExisting` never bought, and what removing `Scope.REQUEST` changed.** Historically,
sharing one `QueryRunner` *within a request* was required only by a use case taking several scoped
repos at once — in this codebase, only `CreateTransaction`. It was irrelevant *between* requests:
`Scope.REQUEST` already yielded one instance per request, so two concurrent requests always had
separate `QueryRunner`s. Cross-request serialization is the Postgres row lock — held until commit
and visible on any connection — and that hasn't changed. What P3+P4 changed is the *mechanism*:
there is no more `Scope.REQUEST` anywhere, every impl is a singleton, and a fresh `QueryRunner` is
created on every `run()` call regardless of how many concurrent callers share the same instance.
"One instance per request" was never the axis that mattered; "one `QueryRunner` per invocation" is,
and `run()` now guarantees that structurally. Hence a module whose flows touch one aggregate can own
its impl at no cost to concurrency, which is why `IAccountUnitOfWork` moved out first, and
`IBudgetUnitOfWork` followed the same reasoning: neither `UpdateBudgetLimit` nor `DeleteBudget` ever
needed a `QueryRunner` shared with `transactions`, so the `forwardRef(() => TransactionsModule)` that
`budgets.module.ts` used to resolve the token was pure DI-graph cost with no concurrency benefit.
Pattern details in [uow-decision.md](../src/shared/domain/uow-decision.md).

**Accepted cost of the split.** Before this, `useExisting` made it structurally impossible for a use
case to open two separate DB transactions by injecting `ITransactionUnitOfWork` and
`IBudgetUnitOfWork` together — both tokens resolved to the same instance, so there was only ever one
`QueryRunner`. Now that the two ports have independent impls, that guarantee is gone: a use case
injecting both and calling `run()` on each **nested in the same async chain** (one callback awaiting
the other's `run()`) is caught — `activeTransaction`, an `AsyncLocalStorage` nesting detector, throws
`NestedTransactionError` before the second `QueryRunner` is even created. What is *not* caught is two
`run()` calls that aren't nested — sequential (`await a.run(...); await b.run(...)`, two ordinary
unrelated transactions, not a bug) or racing via `Promise.all` (different async chains, invisible to
the detector; if they need the same row, ordinary Postgres lock contention or a real `40P01`
deadlock results, instead of a silent hang). Nothing enforces "at most one UoW port per use case" in
the type system — see CLAUDE.md's anti-patterns list. If a future flow needs to coordinate
`transactions` and `budgets` atomically, it belongs inside `TypeOrmUnitOfWorkImpl`, composing
`budgets`' scoped repos the way `CreateTransaction` already does (exposed as extra `ctx` properties)
— not by injecting two module-specific UoW ports side by side.

---

## 4. Lock map

| Read (scoped) | Lock | Serializes |
| --- | --- | --- |
| `ScopedAccountRepository.findByIdWithLock` | **FOR UPDATE** | Balance mutations: Create/DeleteTransaction + Archive/Unarchive/Rename (Race 2, Bug B). Defined in `accounts/infrastructure/persistence/scoped-account.repository.ts`; the two callers reach it from different UoWs and therefore different `QueryRunner`s — the row lock serializes them regardless. Since P5, both callers see it through `IScopedAccountRepository` (`findByIdWithLock` + `save` only — no `findByUserId`/`delete`) |
| `ScopedBudgetRepository.findByIdWithLock` | **FOR UPDATE** | UpdateBudgetLimit, DeleteBudget vs concurrent creates. Defined in `budgets/infrastructure/persistence/scoped-budget.repository.ts`; `BudgetUnitOfWorkImpl` and `TypeOrmUnitOfWorkImpl` reach it through sibling factories on different `QueryRunner`s — same shape as `ScopedAccountRepository` above |
| `ScopedBudgetRepository.findByUserIdAndCategoryIdAndPeriodWithLock` | **FOR UPDATE** | The period-invariant gate in CreateTransaction (Bug A). Since P5 this is the ONLY budget capability `transactions` gets, via the sibling port `IScopedBudgetPeriodReader` (`ctx.budgetPeriodReader`, not `ctx.budgets`) — by type, `CreateTransaction` can no longer `save`/`delete` a budget |
| `ScopedTransactionRepository.findByIdWithLock` | **FOR UPDATE** | Double DELETE of the same tx (Race 3) |
| `ScopedRefreshTokenRepository.findByTokenHashWithLock` | **FOR UPDATE** | Two `/refresh` with the same token → replay detection |
| `sumExpenseAmountByUserCategoryAndPeriod` | **no lock** (aggregate) | Serialized by the budget lock taken beforehand |
| `ScopedExpenseChecker.hasExpensesInPeriod` / `sumExpenseAmountInPeriod` | **no lock** (aggregate) | Serialized by the budget lock of Delete/Update. Lives in `budgets/infrastructure/persistence/scoped-expense-checker.ts`, served by `BudgetUnitOfWorkImpl` — moved out of `transactions/infrastructure/persistence/unit-of-work.impl.ts` when `IBudgetUnitOfWork` got its own impl. Closes Race 1 (`hasExpensesInPeriod`) and B4 (`sumExpenseAmountInPeriod`) |

Aggregates (`SUM`/`COUNT`) **cannot** take `FOR UPDATE` (Postgres forbids it) and it wouldn't
help anyway: a lock on existing rows does not stop *phantom inserts* in the range. Their consistency
comes from the guardian-row lock that the caller takes **first**.

> This table answers *what serializes two concurrent writers*. Its mirror,
> [`data-model.md`](./data-model.md) §2, answers *what rejects a single invalid one* —
> which constraint or check defends each invariant, in which layer, and what the caller
> gets back.

---

## 5. One mutex per invariant (not a global mutex)

There is no single "the mutex". **Each invariant has its own guardian row**, and a flow takes one lock per
invariant it mutates:

| Invariant | Guardian row | Locked by |
| --- | --- | --- |
| Σ period expenses ≤ limit | `budgets` row for the period | CreateTransaction, UpdateBudgetLimit, DeleteBudget |
| Correct account balance | `accounts` row | CreateTransaction, DeleteTransaction, Archive/Unarchive/Rename |
| No double-reverse of a tx | `transactions` row | DeleteTransaction |
| No refresh-token replay | `refresh_tokens` row | RefreshToken |

That is why `CreateTransaction` takes **two** locks (budget + account): it crosses two invariants. The
budget lock does **not** protect the balance — other flows (`Archive`, `DeleteTransaction`) mutate the
account without touching the budget, so if you didn't take the account lock, a concurrent `Archive`
would cause a lost update on the balance. Each row protects against a different set of competitors.

---

## 6. The skeleton of every transactional flow

```
1. Fail-fast OUTSIDE the UoW (global repo, no lock): cheap 404/403/400, grabs no connection
2. uow.run(async (ctx) => {          — opens QueryRunner + tx, builds ctx exactly once
3.   ctx.x.findById FOR UPDATE       — takes the guardian-row lock
4.   dependent reads                 — aggregates; inherit the exclusion from the lock in (3)
5.   invariant decision              — with data read AFTER the lock
6.   ctx.x.save() / delete()         — writes, still under the lock
7. })                                — commit on a clean return, rollback on a thrown error,
                                        release always: ALL of it now lives inside run(), not
                                        in the use case — there is no commit()/rollback() call
                                        left to write by hand
```

The 3→6 ordering **is** the correctness. Locking the guardian row *before* reading the data that
feeds the decision is what closes the race window.

---

## 7. The critical flows

### `CreateTransaction` (takes TWO locks)

1. **Outside the UoW:** creates `Amount`/`Nature` VOs; validates account exists+owned; validates category
   exists+owned and `nature` matches (R7); if expense, validates a budget exists for the period (global,
   no lock). Fail-fast: 404/403/400 without opening a connection.
2. `uow.run(async (ctx) => {`
3. **LOCK budget** (expense only): `ctx.budgetPeriodReader.findByUserIdAndCategoryIdAndPeriodWithLock` → `FOR UPDATE`.
4. **Dependent read:** `ctx.transactions.sumExpenseAmountByUserCategoryAndPeriod` (no lock, post-gate).
5. **Decision:** `spent + amount ≤ limit`? if not → `BudgetLimitExceededException` (422).
6. **LOCK account** + write: `updateBalance` → `ctx.accounts.findByIdWithLock FOR UPDATE` → recomputes → `save`.
   Then `ctx.transactions.save(transaction)`.
7. `})` — commit/rollback/release handled entirely by `run()`.

### `DeleteTransaction`

1. **Outside the UoW:** `GetTransactionByIdUseCase` (global) → cheap 404/403.
2. `uow.run(async (ctx) => {`
3. **LOCK transaction:** `ctx.transactions.findByIdWithLock(id)` → `FOR UPDATE`. If null (someone else deleted it and committed) →
   `TransactionNotFoundException`.
4. —
5. **Decision:** reversing an income would leave a negative balance → `InsufficientFundsException`, thrown by
   `UpdateAccountBalanceUseCase`. `run()` rolls back and re-throws it unwrapped; the use case catches it
   **outside** `run()` and translates it to `CannotDeleteTransactionException` (409) — the rollback has
   already happened by then, so the translation only changes which exception the controller sees.
6. **LOCK account** + write: `updateBalance` (reverse) → `ctx.accounts.findByIdWithLock FOR UPDATE`; `ctx.transactions.delete`.
7. `})` — commit/rollback/release handled entirely by `run()`.

### `UpdateBudgetLimit`

1. — (inline ownership).
2. `uow.run(async (ctx) => {`
3. **LOCK budget:** `ctx.budgets.findByIdWithLock FOR UPDATE`; inline ownership.
4. **Dependent read:** `ctx.expenses.sumExpenseAmountInPeriod` (no lock, under the budget lock).
5. **Decision:** `new limit < spent` → `BudgetLimitBelowSpentException` (409) [B4].
6. `ctx.budgets.save`. Cache invalidation happens **after** `await uow.run(...)` resolves, in its own
   `try/catch` that only logs — there is no `try` wrapping a `rollback()` left for it to leak into.
7. `})` — commit/rollback/release handled entirely by `run()`.

### `DeleteBudget`

1. — (inline ownership).
2. `uow.run(async (ctx) => {`
3. **LOCK budget:** `ctx.budgets.findByIdWithLock FOR UPDATE`; inline ownership.
4. **Dependent read:** `ctx.expenses.hasExpensesInPeriod` (no lock, under the budget lock).
5. **Decision:** there are expenses in the period → `BudgetHasTransactionsInPeriodException` (409) [Race 1].
6. `ctx.budgets.delete`. Cache invalidation after `run()` resolves, same shape as `UpdateBudgetLimit`.
7. `})` — commit/rollback/release handled entirely by `run()`.

### `Archive` / `Unarchive` / `Rename` account (all three, identical skeleton)

1. — (inline ownership).
2. `uow.run(async (ctx) => {`
3. **LOCK account:** `ctx.accounts.findByIdWithLock FOR UPDATE`; inline ownership. Competes for the same row as
   Create/DeleteTransaction [Race 2].
4. —
5. **Decision:** domain method (`archive()` throws if already archived, etc.).
6. `ctx.accounts.save`.
7. `})` — commit/rollback/release handled entirely by `run()`.

### `RefreshToken` (auth — separate UoW)

1. **Outside the UoW:** verifies the token signature (`ITokenProvider`) — fail-fast without touching the DB.
2. `uow.run(async (ctx) => {`
3. **LOCK refresh-token:** `ctx.refreshTokens.findByTokenHashWithLock FOR UPDATE`.
4. —
5. **Decision:** null → throws `InvalidRefreshTokenException` (rolls back); expired → throws
   `RefreshTokenExpiredException` (rolls back); revoked → replay → `revokeFamily` then **returns**
   `{ kind: 'replay' }` — a normal return, so `run()` commits. The use case reads that outcome
   **after** `run()` resolves and throws `RefreshTokenReplayDetectedException` only then — the family
   revocation must survive even though the request ends in 401, and by the time the exception is
   thrown, `run()` has already committed it.
6. Inserts the new one (same `familyId`), revokes the old one (`replacedById = new jti`). Inserts **before**
   revoking, because of the self-referential FK. Returns `{ kind: 'rotated', pair }`.
7. `})` — commit/rollback/release handled entirely by `run()`.

> **Latent bug (noted, not active):** the **global** impl `RefreshTokenRepositoryImpl.findByTokenHashWithLock`
> also requests `pessimistic_write`. Outside a `QueryRunner` (autocommit connection) that would throw
> `PessimisticLockTransactionRequiredError`. It doesn't blow up because it is dead code: only the scoped
> one (`ScopedRefreshTokenRepository`, inside the UoW) calls it. Rule: never call `findByTokenHashWithLock`
> on the global repo.

---

## 8. Lock ordering and deadlocks

When a flow takes **more than one** lock, the order matters: two flows taking the same two locks in
opposite order can deadlock (A waits for B, B waits for A).

Acquisition order in the system:

- `CreateTransaction`: **budget → account**
- `DeleteTransaction`: **transaction → account**
- everything else: a single lock

No flow takes `account → budget` or `account → transaction`. In other words, **there is no order
inversion** on any pair of rows, so there is no deadlock by construction. If a multi-lock flow is added
in the future, it must respect the same order (the account row is locked **last**).

---

## 9. Consistency model: writes vs reads

### Writes → strong consistency

Every invariant mutation goes through the skeleton in §6: it re-reads under `FOR UPDATE` inside the UoW and
decides on fresh data. There is no path that writes a balance/limit "raw" without first
locking and re-reading. That is why the read-modify-writes are atomic by construction.

### Reads → benign stale reads (and that is the right call)

The **global** repos run in autocommit, `READ COMMITTED`, **without locks**. They can return stale
data — and that is fine, for three reasons:

1. **They can't break an invariant.** The invariant is enforced at *write* time, under lock, re-reading inside
   the UoW. A stale read **never feeds a write decision** → it can only end up on a
   screen. If it can't touch an invariant, there is nothing to fix.
2. **Serializing reads would be a performance disaster.** Reads outnumber writes by
   orders of magnitude. `FOR SHARE` on every read (or global `SERIALIZABLE`) would make readers
   block against writers and each other: you'd trade milliseconds of benign staleness for widespread
   contention.
3. **The window is tiny and self-healing.** It lasts as long as the tx (ms) and the next read sees the
   committed value.

**Mechanism detail:** a plain `SELECT` does **not** block against a row locked with `FOR UPDATE`.
In `READ COMMITTED`, readers don't block writers and vice versa. The staleness is not "the read waits and
returns old data"; it is "the read **does not wait** and returns the last committed value, ignoring the change in
flight".

**Read-your-own-writes:** staleness only appears between **concurrent** operations by different
actors. Your own sequential actions never see it: the mutation **commits before** the HTTP response
is sent, so your next `GET` already sees the new value.

### Where the stale read shows up

| Scenario | What you see |
| --- | --- |
| `GET /accounts/:id` while a transaction is being created (mid-flight) | The balance prior to the in-flight inflow/outflow |
| `GET /budgets` while an expense is being created | A `spent` lower than what it will be |
| `GET /transactions` after an uncommitted create from another request | The new tx doesn't show up yet |
| Fail-fast pre-checks (global repo) | May read stale — but they are re-verified under lock inside the UoW |

### If you ever need a consistent read

Don't raise the global isolation level. Do it **surgically**: that specific read inside a
`REPEATABLE READ` tx, or `FOR SHARE` on that query, or read it inside the same UoW. Rule: **relaxed by
default, strict only where it is proven to matter, and always local.**

---

## 10. Diagrams

### Happy path — `CreateTransaction` of an expense

```mermaid
sequenceDiagram
    participant UC as CreateTransactionUseCase
    participant UoW
    participant DB as Postgres

    Note over UC: Fail-fast (global repos, no lock): account, category, budget exists
    UC->>UoW: uow.run(async (ctx) => { ... })
    UoW->>DB: createQueryRunner + START TRANSACTION
    UoW->>UC: ctx (built once by createContext())
    UC->>UoW: ctx.budgetPeriodReader.findByUserIdAndCategoryIdAndPeriodWithLock()
    UoW->>DB: SELECT budget ... FOR UPDATE (lock)
    UC->>UoW: ctx.transactions.sumExpenseAmountByUserCategoryAndPeriod()
    UoW->>DB: SELECT COALESCE(SUM(amount),0)   (no lock)
    Note over UC: decision: spent + amount <= limit ?
    UC->>UoW: ctx.accounts.findByIdWithLock()
    UoW->>DB: SELECT account ... FOR UPDATE (lock)
    UC->>UoW: ctx.accounts.save(account) + ctx.transactions.save(tx)
    Note over UC,UoW: callback returns cleanly — no explicit commit() call
    UoW->>DB: COMMIT  (releases budget and account locks)
    UoW->>DB: release()  (connection back to the pool)
```

### Two concurrent expenses in the same period (the lock serializes)

```mermaid
sequenceDiagram
    participant A as Request A
    participant B as Request B
    participant DB as Postgres

    A->>DB: SELECT budget FOR UPDATE (A acquires the lock)
    B->>DB: SELECT budget FOR UPDATE (B BLOCKS, waits for A)
    A->>DB: SUM expenses = 90 -> 90+5 <= 100 OK
    A->>DB: INSERT expense (5) + COMMIT (lock released)
    Note over B: B unblocks and reads FRESH state
    B->>DB: SUM expenses = 95 -> 95+5 = 100 <= 100 OK
    B->>DB: INSERT expense (5) + COMMIT (lock released)
    Note over A,B: Sum = 100 <= 100. Without the lock, both would read 90 and the sum would have been 100... or more with N requests.
```

---

## 11. Historical races (all closed)

| ID | Scenario | Closure |
| --- | --- | --- |
| Bug A | `PATCH /budgets/:id/limit` vs `POST /transactions` (limit write skew) | `FOR UPDATE` on the budget row; create reads through the scoped repo |
| Bug B | Two `POST /transactions` on the same account (balance lost update) | `FOR UPDATE` on the account row |
| Bug E | Two `POST /auth/register` with the same email → 500 | `catch 23505` → `UserAlreadyExistsException` (409) |
| Race 1 | `DELETE /budgets/:id` vs `POST /transactions` (TOCTOU) | DeleteBudget under UoW; checker under the budget lock |
| Race 2 | `PATCH /accounts/:id/{archive,unarchive,name}` vs tx mutations | all three under `IAccountUnitOfWork`; `findById FOR UPDATE` |
| Race 3 | Two `DELETE /transactions/:id` (double-reverse) | `FOR UPDATE` on the tx row; fail-fast outside + re-fetch inside |
| B4 | `PATCH /budgets/:id/limit` could lower the limit below what was spent | sum under the budget lock → `BudgetLimitBelowSpentException` (409) |

Detailed post-mortems: [race-conditions-fix-2026-05.md](./history/race-conditions-fix-2026-05.md) (Race 1/2)
and each module's `notes-history.md` (Bug A/A.2/B, Bug E).

---

## 12. Concurrency tests

`test/integration/concurrency/concurrency.integration.spec.ts` against a real Postgres. The technique:
fire N requests with `Promise.all` and assert on the **final state**, not on each request.

- **Lost update:** N concurrent inflows → `currentBalance` must be the exact sum (if an update is
  lost, it comes out lower).
- **Invariant:** N expenses brushing the limit → only those that fit must pass (201), the rest 422.
- **Empty-period regression:** proves the serialization comes from the *budget* lock and not from locking
  pre-existing expense rows.
- **Two different operations:** `PATCH limit` vs `POST transaction` → exactly one wins; neither 500s.

A `500` under load almost always = deadlock or blown constraint → the serialization failed.

Validated on 2026-06-15: temporarily removing each lock makes the tests **go red** (account lock →
balance lost update; budget lock → limit exceeded + empty period; transaction lock → double reverse
in Race 3). In other words, the tests **bite** — they don't pass by accident.

---

## 13. Design fragility (known debt — to be addressed later)

The model is **correct but fragile-by-convention**: its correctness relies on human discipline, not on
guarantees enforced by the compiler or the tests. Two documented cracks remain (a third, 13.1, closed):

### 13.1 Implicit locks ("spooky action at a distance") — **CLOSED by P5**

> Closed by P5 (`docs/history/structural-refactors.md`). Kept as a record of the risk and why the eventual fix took the
> shape it did — the two fixes proposed below when this section was still open turned out to be wrong
> in different ways.

The risk this section used to describe: the `FOR UPDATE` lived *inside* the scoped repo's `findById`,
and the call site (`budgetRepo.findById(id)`) gave no indication that the line took an exclusive
lock. A contributor adding a write flow with the **global** repo instead of the scoped one could
reopen a race without anything detecting it.

Two things changed since this was written, neither of which is the fix originally proposed here:

1. **The method itself now says `findByIdWithLock`.** The rename makes the lock visible at every call
   site without needing a second interface — this alone predates P5 (it mirrors
   `IScopedTransactionRepository.findByIdWithLock` and `findByTokenHashWithLock` in auth).
2. **P5 additionally narrows what each *consumer* can do with the result**, which is a different axis
   from naming the lock. This section originally proposed `IScopedAccountRepository extends
   IAccountRepository` — that shape was rejected when P5 actually landed: inheriting the full port
   would have dragged along `delete()` and `findByUserId()`, exactly the operations P5 exists to take
   away from a consumer that doesn't own the aggregate. The port that shipped is a **sibling**, not a
   subtype (`IScopedAccountRepository`, `IScopedBudgetRepository`,
   `IScopedBudgetPeriodReader` — none `extends` a global repo port). `transactions` now holds
   `ctx.accounts: IScopedAccountRepository` (`findByIdWithLock` + `save`, no `delete`/`findByUserId`)
   and `ctx.budgetPeriodReader: IScopedBudgetPeriodReader` (read-only) instead of the full
   `IAccountRepository`/`IBudgetRepository`. A compile-only type-test
   (`transactions/domain/__type-tests__/uow-narrowing.type-test.ts`, gated by `npm run build`) fails
   if a scoped context ever regains `save`/`delete` on an aggregate its consumer doesn't own.

What P5 does **not** claim to fix: `ctx.accounts` still lets `transactions` write any balance it
wants — that is the legitimate multi-aggregate invariant transactions anchors (see CLAUDE.md, "Why
the impl lives in transactions"), not a hole P5 left open.

### 13.2 Lock ordering not enforced (deadlock risk)

Today there is no deadlock because all flows take the locks in the same order (**budget → account**, the
account always last — see §8). But that order is a **convention in the head** of whoever wrote the
flows; nothing enforces it.

**Risk:** a future flow that takes `account → budget` introduces an AB-BA cycle. Postgres would detect it
(`deadlock_timeout` ~1s → aborts one tx with `40P01` → 500), but only in production and under load. The
compiler says nothing.

**Robust fix (future):** document the canonical order as a review rule + ideally a concurrency
test that exercises the pair of flows in reverse order to catch the regression.

### 13.3 The gate depends on *every* writer honoring it

The budget row serializes the period SUM **only because every writer of period expenses takes its
`FOR UPDATE` first** (the "talking stick" pattern). It is an agreement, not a physical enforcement: the budget
lock does not cover the `transactions` rows.

**Risk:** a flow that inserts an expense **without** going through the budget lock bypasses the gate and the
"Σ ≤ limit" invariant breaks silently.

**Robust fix (future):** funnel all expense creation through the same use case/UoW (true today), and
leave a test that fails if a second expense-insertion path appears.

### Why this is deferred

All three are correct **today** and the cost of hardening them (scoped interfaces, more tests, enforced
conventions) is not justified at the current learning/portfolio scale. They are documented here so the
decision is **conscious** and so the next change that touches them knows it is walking on thin ice.
