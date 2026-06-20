# ADR-0002: Unit of Work + pessimistic row locks for cross-aggregate invariants

- **Status:** Draft
- **Date:** YYYY-MM-DD
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
> opens a request-scoped Unit of Work, obtains **scoped repositories** that share one
> `QueryRunner` (one PostgreSQL transaction), and takes `SELECT ... FOR UPDATE` on the
> budget row and the account row before computing and writing. The budget row acts as a
> **logical mutex** for the "Σ period expenses ≤ limit" invariant. Closed races are
> catalogued in [`concurrency-model.md`](../concurrency-model.md) and
> [`history` race-conditions notes](../history/race-conditions-fix-2026-05.md).

## Decision

Multi-aggregate mutations run inside a request-scoped Unit of Work → a single
`QueryRunner` → a single DB transaction. Scoped repos take **pessimistic** locks
(`FOR UPDATE`) on the rows that gate the invariant. Aggregate reads (`SUM`/`COUNT`)
take no lock and are serialized by the row lock taken first.

## Why this option

<!--
Why pessimistic locking rather than optimistic concurrency? Was it driven by a
concrete bug you reproduced, or by wanting the simplest provably-correct option?
Why is "strong consistency on writes, relaxed on reads" the right trade-off here?
(You already argue this in concurrency-model.md — distil the decision rationale.)
-->

## Alternatives considered

- **Optimistic concurrency (version column + retry on conflict):** <!-- Why rejected? contention profile? retry complexity? -->
- **`SERIALIZABLE` isolation level:** <!-- Why rejected? serialization-failure retries, throughput? -->
- **Application-level / advisory locks instead of row locks:** <!-- Why rejected? -->

## Consequences

**Positive**

- Invariants are provably safe under concurrency; races are closed at the DB layer, not hoped away.

**Negative / trade-offs**

- Lock contention on hot budget/account rows; requests serialize where they compete.
- Locking discipline must be respected (only the scoped repos lock; the global repo does not). <!-- expand -->

**Follow-ups**

-
