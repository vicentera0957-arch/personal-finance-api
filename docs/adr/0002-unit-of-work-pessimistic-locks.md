# ADR-0002: Unit of Work + pessimistic row locks for cross-aggregate invariants

- **Status:** Accepted
- **Date:** 2026-06-20
- **Deciders:** Vicente Cristobal Rivas Avello

## Context and problem statement

Several invariants in this domain span more than one aggregate and involve money:

- an account balance must reflect every transaction exactly once;
- the sum of an period's expenses must not exceed its budget limit;
- a budget cannot be deleted/lowered below what is already spent.

All of them are anchored to a `Transaction` mutation, and all are vulnerable to
**read-validate-write** races between concurrent HTTP requests (write skew,
lost updates, TOCTOU).

> Fact from the code: [`CreateTransactionUseCase`](../../src/modules/transactions/application/use-cases/create-transaction.use-case.ts)
> calls `uow.run()`, which opens one `QueryRunner` = one PostgreSQL transaction for that
> call and hands the callback a context of **scoped repositories** sharing it. It takes
> `SELECT ... FOR UPDATE` on the budget row and the account row before computing and
> writing. The budget row acts as a **logical mutex** for the "Σ period expenses ≤ limit"
> invariant. Closed races are catalogued in
> [`concurrency-model.md`](../concurrency-model.md) and
> [`closed-race-conditions.md`](../history/closed-race-conditions.md).

## Decision

Multi-aggregate mutations run inside a Unit of Work → a single `QueryRunner` → a single
DB transaction. Scoped repos take **pessimistic** locks (`FOR UPDATE`) on the rows that
gate the invariant. Aggregate reads (`SUM`/`COUNT`) take no lock and are serialized by
the row lock taken first.

Isolation stays at PostgreSQL's default `READ COMMITTED`.

## Why this option

The decision came from reproduced bugs, not from theory. Seven races were found and
closed (see [`closed-race-conditions.md`](../history/closed-race-conditions.md)); the
first was a textbook write skew — two concurrent expenses each read the same stale
period sum, each validated correctly on its own, and together they overspent the budget.

Postgres offers a global switch for exactly that: `SERIALIZABLE` detects the anomaly at
commit and aborts one transaction with `40001`. The reason not to use it is where the
failure lands. `SERIALIZABLE` moves the problem into the application: every write path
needs retry logic, because any transaction can now abort through no fault of its own.
That means idempotency concerns, backoff, and a failure mode that only appears under
load — on a first backend project, that is more machinery to get wrong than the thing
it replaces.

So: keep `READ COMMITTED` and **manufacture serialization exactly where the invariant
needs it**. Don't ask the database for global protection; build point protection where a
mistake costs money, and leave every read path cheap. This is what makes the
"strong on writes, relaxed on reads" split the right trade-off here — reads outnumber
writes by orders of magnitude, and a stale read never feeds a write decision, because
every write re-reads under lock inside the UoW. A stale read can only reach a screen.

The subtlety that shaped the design: **you cannot lock a `SUM`.** Postgres refuses
`FOR UPDATE` on aggregates, and even if it didn't, locking existing rows can't stop a
phantom insert into the range. So the aggregate carries no lock at all and inherits its
consistency from the guardian row locked *first*. That inversion — a lock on row X
protecting a query over rows Y₁…Yₙ — is the whole model, and it works only because
every writer of period expenses honours it.

## Alternatives considered

- **`SERIALIZABLE` isolation.** Rejected: correct, but it relocates the failure into
  application-level retries on every write path (see above). Pessimistic locks put the
  cost where it is visible and local.
- **Optimistic concurrency (version column + retry on conflict).** Rejected for the
  same reason plus a worse fit: the budget invariant is not "this row changed under me"
  but "the *set* of rows I summed changed under me". A version column on `budgets`
  wouldn't move when a `transactions` row is inserted, so the conflict it detects isn't
  the conflict that matters. It would need a manually bumped counter — a hand-rolled
  lock with more moving parts than `FOR UPDATE`.
- **Advisory locks (`pg_advisory_xact_lock`) instead of row locks.** Rejected: they'd
  work, but they add a second, invisible namespace of lock keys to keep in sync with
  the rows they stand for. The row already exists and is already the thing being
  protected. Row locks also show up in `pg_locks` against a real relation, which makes
  contention diagnosable.
- **Enforcing the sum with a DB `CHECK` constraint.** Rejected as impossible: `Σ
  expenses ≤ limit` spans a set of rows, which no `CHECK` can express. Materialising
  the running total into a column to make it checkable is just the lock model again,
  with a denormalised field to keep correct.

## Consequences

**Positive**

- Invariants are provably safe under concurrency; races are closed at the DB layer, not hoped away.
- No retry logic anywhere. A blocked request waits and then reads fresh state.
- Deadlock-free **by construction**, not by timeout tuning: every multi-lock flow takes
  the locks in the same order (budget → account, account always last), so no AB-BA
  inversion exists.

**Negative / trade-offs**

- Lock contention on hot budget/account rows; requests serialize where they compete.
  Acceptable here — contention is per user, per category, per month.
- Locking discipline must be respected: only the scoped repos lock, and only inside an
  active transaction. A scoped repo built on `dataSource.manager` would take a
  `FOR UPDATE` that Postgres releases the instant the `SELECT` ends — correct-looking,
  silently useless, and not reliably catchable by an integration test. That failure mode
  is what [ADR-0009](./0009-scoped-repositories-as-guarded-factories.md) exists to make
  impossible at compile time.
- The lock ordering rule and the "every expense writer takes the budget lock" agreement
  live in prose, not in the compiler. Documented as known debt in
  [`concurrency-model.md` §13](../concurrency-model.md).

**Follow-ups**

- Distributed tracing would show lock-wait time per request in production. For a system
  built on pessimistic locks, that is the observability gap worth closing first.
