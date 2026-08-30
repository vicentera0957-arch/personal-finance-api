# ADR-0013: No partial index for the period-sum query; the composite index already covers it

- **Status:** Accepted
- **Date:** 2026-07-02 · re-measured at 1.000.000 rows 2026-08-12 · recorded as an ADR 2026-08-30
- **Deciders:** Vicente Cristobal Rivas Avello

## Context and problem statement

The hottest query in expense creation is
`ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod` — it runs inside the
Unit of Work on every `POST /transactions` that touches a budgeted category:

```sql
SELECT COALESCE(SUM(amount), 0)
FROM transactions
WHERE user_id = $1 AND category_id = $2 AND nature = 'expense'
  AND transaction_date >= $period_start AND transaction_date < $period_end;
```

`CLAUDE.md` carried this in its *Known gaps* section:

> *"Missing partial index for the period-sum query … Current full-table scans are fine at
> small scale."*

That entry was **documentation drift**. The index exists, and has since day one:
`InitialSchema1780590020486` creates

```sql
CREATE INDEX idx_tx_user_cat_nature_date
  ON transactions (user_id, category_id, nature, transaction_date);
```

which is a textbook match for the query — equality on the first three columns, a range on
the last. There were never any full-table scans. The open question was therefore not "add
the missing index" but the narrower one: **is a partial index on `WHERE nature = 'expense'`
worth adding on top?**

## Decision

We will **not** add the partial index. The existing composite index covers the query and
the planner uses it.

Revisit **if and only if** the table reaches millions of rows **and** monitoring shows
index size or write latency to be a problem — and then measure against real data first.

## Why this option

Because it was measured, twice, and the difference does not exist.

**50.000 rows, PostgreSQL 15** — 1 user, 3 categories, both `nature` values, 360 days of
2026. Target subset (`user, C1, expense, June`): ~695 rows, ~1,4 % of the table.
`EXPLAIN ANALYZE` inside a `BEGIN … ROLLBACK`:

| | Index used | Estimated cost | Actual execution |
| --- | --- | --- | --- |
| Current composite | `idx_tx_user_cat_nature_date` | 863,72 | **0,453 ms** |
| + partial | `idx_tx_expense_period` | 853,61 | **0,519 ms** |

~1 % apart on estimated cost, indistinguishable on the clock, and both plans are the same
shape: a sub-millisecond Bitmap Index Scan feeding an Aggregate. The partial index is not
faster; it lost, inside the noise.

**1.000.000 rows** — re-run in the performance lab ([`performance.md`](../../performance.md)
§2, E5) at a scale the first benchmark could not reach. The conclusion held, and it
sharpened the honest version of the argument: the only theoretical advantage of a partial
index here is **size** — it indexes fewer rows and drops `nature` from the key — but in
that dataset **94,6 % of rows are `expense`**. A partial index on `WHERE nature =
'expense'` excludes 5,4 % of the table. Whatever it buys, it is not size. Its value would
be specialisation, and specialisation is what the composite index is already doing.

There is a second cost that the timing table does not show. The partial index **cannot be
declared with TypeORM 0.3's `@Index` decorator** — it does not model partial indexes — so
it would have to go in as raw SQL in a migration
([ADR-0007](./0007-migrations-over-synchronize.md)), reintroducing exactly the
entity ↔ database drift that migration policy exists to bound. Paying that for a 1 %
planner estimate is a bad trade.

**What this decision is really about.** The interesting part is not the benchmark result —
it is that a "missing index" sat in *Known gaps* as a real deficiency and had never been
missing. It produced a **planned schema change to fix a problem that did not exist**. The
correction touched `CLAUDE.md` and the index comment in `transaction.orm.entity.ts`, and
it is the origin of this repository's standing convention: **when the code and a doc
disagree, the code wins — and the doc gets fixed in the same PR.**

## Alternatives considered

- **Option A — add `idx_tx_expense_period` now:** rejected. Measured no faster at 50 k and
  no smaller in any meaningful sense at 1 M (94,6 % of rows qualify), while adding write
  amplification on the hottest table and entity ↔ DB drift.
- **Option B — replace the composite index with the partial one:** rejected. The composite
  index also serves queries that filter `nature = 'income'` or do not filter on `nature` at
  all; dropping it to specialise one call path trades a general win for a measured
  non-win.
- **Option C — a covering index with `INCLUDE (amount)`:** not rejected on principle, but
  out of scope here — that is an index-only-scan question, measured separately as E6 in
  [`performance.md`](../../performance.md) §2, and it does not depend on `nature` being
  partial.
- **Option D — materialise the period sum:** rejected. A summary table or counter needs its
  own locking to stay consistent with `transactions` under the concurrency model of
  [ADR-0002](./0002-unit-of-work-pessimistic-locks.md) — real complexity bought to
  optimise a query that already runs in half a millisecond.

## Consequences

**Positive**

- No schema change, no migration, no new write amplification on `transactions`.
- The entity keeps modelling every index on the table, so `synchronize`-generated diffs
  stay readable ([ADR-0007](./0007-migrations-over-synchronize.md)).
- The measurement is on record, so the question does not get re-opened from intuition.

**Negative / trade-offs**

- The index key carries `nature` for every row, including the ~5 % that will never be
  summed by this query. Accepted: measured as noise.
- The decision is scale-bound. It is correct at 10⁶ rows and it is not a permanent answer.

**Follow-ups**

- If it is ever added, the migration is already written:

  ```sql
  -- up()
  CREATE INDEX idx_tx_expense_period
    ON transactions (user_id, category_id, transaction_date)
    WHERE nature = 'expense';

  -- down()
  DROP INDEX idx_tx_expense_period;
  ```

- Related: [ADR-0007](./0007-migrations-over-synchronize.md) (why DB objects TypeORM
  cannot model declaratively live in migrations),
  [ADR-0010](./0010-keyset-pagination.md) (the other index decision that came out of the
  same lab).
- Full lab narrative and raw `EXPLAIN` output: [`performance.md`](../../performance.md) §2 ·
  [`perf/`](../perf/).
