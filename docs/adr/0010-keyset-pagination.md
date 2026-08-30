# ADR-0010: Keyset pagination for transaction listings

- **Status:** Proposed
- **Date:** 2026-08-15
- **Deciders:** Vicente Cristobal Rivas Avello

## Context and problem statement

`ITransactionRepository.findByUserId` and `findByAccountId` paginate with TypeORM's
`skip`/`take`, which compile to `OFFSET`/`LIMIT`
(`transactions/infrastructure/persistence/transaction.repo.implement.ts`). The HTTP layer
exposes that directly: the caller sends an offset and gets a page back.

Two problems, both measured against 1.000.000 rows — the raw output is in
`docs/perf/salida/e17a-offset.txt` and `e17c-keyset.txt`, the narrative in
`performance.md` §4.

**It does not scale with depth.** `OFFSET n` does not seek to row *n*; it produces *n*
rows and throws them away. Same `LIMIT 20`, same user, only the offset changes:

| `OFFSET` | Buffers | Time |
| --- | --- | --- |
| 0 | 6 | 1,14 ms |
| 10.000 | 995 | 31,4 ms |
| 100.000 | 18.568 | 246,8 ms |
| 200.000 | 19.236 + 2.713 temp | **617,3 ms** |

At 200.000 the plan degrades qualitatively: the planner abandons the index scan and
materialises 200.020 rows into an on-disk sort (`external merge Disk: 11152kB`) to return
twenty of them.

**It is also incorrect under concurrent writes**, which matters more. `OFFSET` counts from
the beginning on every request, so a row inserted above the current page shifts everything
down by one and the next page repeats a row. Reproduced:

```text
page 1 (OFFSET 0 LIMIT 3) → rows A, B, C
  a newer transaction is inserted
page 2 (OFFSET 3 LIMIT 3) → rows C, D, E      ← C served twice
```

The user does not see an error. They see a duplicated item, or never see one that exists.

A note on what this is *not*: an earlier draft blamed the missing `id` tie-breaker in
`ORDER BY transaction_date DESC`. That mechanism did not reproduce — tested by resolving
the same page through two different plans, and by aiming the offset directly at a
duplicate timestamp. Both returned identical ids in identical order. The tie-breaker is
still required (a keyset cursor must be unique) but it is not, by itself, the bug.

## Decision

We will paginate transaction listings by **keyset**: the client sends an opaque cursor
encoding the last row it saw, and the query asks for what comes after it.

```sql
SELECT ... FROM transactions
WHERE user_id = $1
  AND (transaction_date, id) < ($2, $3)
ORDER BY transaction_date DESC, id DESC
LIMIT $4;
```

backed by `CREATE INDEX CONCURRENTLY idx_tx_user_date_id_keyset ON transactions (user_id,
transaction_date DESC, id DESC)`.

`page`/`offset` leaves the public contract. Responses carry a `nextCursor` — an opaque,
base64-encoded `(transaction_date, id)` pair — which the client echoes back.

## Why this option

Because the cost stops depending on how deep the caller is. Measured at the same three
points:

| Position | `OFFSET` | keyset |
| --- | --- | --- |
| page 1 | 6 buffers · 1,14 ms | 6 buffers · 0,097 ms |
| row 10.000 | 886 buffers · 2,87 ms | **6 buffers** · 0,177 ms |
| row 200.000 | 18.678 buffers · 529 ms | **5 buffers** · **0,095 ms** |

**3.735× fewer buffers at depth, and flat.** A keyset page is one B-tree descent to the
cursor plus twenty rows forward; depth never enters the calculation.

The correctness argument carries more weight than the performance one. A slow deep page is
a latency problem that monitoring surfaces. A silently duplicated row is a data-integrity
problem the user reports and nobody can reproduce, because it depends on write traffic
arriving between two requests.

`(transaction_date, id) < ($2, $3)` must stay a **row comparison**. Written out as
`date < $2 OR (date = $2 AND id < $3)` the planner can no longer use it to position the
scan, and the whole benefit is gone. This is the one detail an implementer is likely to
get wrong.

## Alternatives considered

- **Option A — keep `OFFSET`, cap the maximum page.** Bounds the latency but not the
  correctness bug, and it makes the API lie: the caller cannot reach data that exists.
- **Option B — keep `OFFSET`, add the `id` tie-breaker.** Cheap (`Incremental Sort`, 9
  buffers vs 6) and it makes the order total. But it does not touch either problem: the
  cost is still O(offset), and rows still shift under a concurrent insert. Worth doing,
  not sufficient.
- **Option C — server-side cursors (`DECLARE`/`FETCH`).** Truly constant per page, but
  requires holding a transaction open across HTTP requests. That contradicts ADR-0002's
  whole model — an open transaction pins the xmin horizon and blocks vacuum database-wide.
- **Option D — snapshot the result set into a temp table per session.** Consistent pages,
  at the cost of storage per active pagination and an eviction policy. Disproportionate
  for a listing endpoint.

## Consequences

**Positive**

- Constant cost per page: ~5 buffers regardless of depth.
- No duplicated or skipped rows under concurrent inserts.
- The order becomes total, so results are reproducible run to run.
- Removes the incentive to cap page depth artificially.

**Negative / trade-offs**

- **Arbitrary page jumps stop existing.** No "go to page 50". Infinite scroll and
  next/previous still work; a numbered pager does not. This is the real cost, and it is a
  product decision, not a technical one.
- A total row count still needs a separate `COUNT(*)`, which keyset does not make cheaper.
- One more index: 56 MB, plus ~4 buffer pages per write (see `performance.md` §2, E8).
- Breaking API change. `page` and `offset` disappear from the contract.
- The cursor must be opaque. Exposing `(date, id)` invites clients to construct their own,
  which freezes the sort order as a public contract forever.

**Follow-ups**

- Migrate `findByUserId` / `findByAccountId` and the DTOs; add the index in a migration.
- Decide the deprecation window for `page`/`offset` before flipping the status to Accepted.
- `idx_tx_user_date` becomes a prefix of the new index and is probably redundant. Confirm
  with `pg_stat_user_indexes.idx_scan` before dropping it.
