# Index for the period SUM

> **Status: APPROVED (2026-07-02).** Recommendation accepted — no schema change; the
> partial index is not added. The documentation drift listed at the bottom was fixed
> in the same change.

## Context

The hottest query in expense creation is `sumExpenseAmountByUserCategoryAndPeriod`
(`ScopedTransactionRepository`):

```sql
SELECT COALESCE(SUM(amount), 0)
FROM transactions
WHERE user_id = $1 AND category_id = $2 AND nature = 'expense'
  AND transaction_date >= $period_start AND transaction_date < $period_end;
```

CLAUDE.md (*Known gaps* section) claimed:

> *"Missing partial index for the period-sum query ... Current full-table scans are fine at small scale."*

This turned out to be **documentation drift**: the index **does exist**.

## Actual schema state

The `InitialSchema1780590020486` migration creates:

```sql
CREATE INDEX idx_tx_user_cat_nature_date
  ON transactions (user_id, category_id, nature, transaction_date);
```

That composite index is a **textbook match** for the query: equality on the first three
columns (`user_id`, `category_id`, `nature`) and a range on the last one (`transaction_date`). There is no
full-table scan.

## Evidence — benchmark (50,000 rows, Postgres 15)

Dataset: 1 user, 3 categories, both `nature` values, 360 days of 2026. The target subset
(`user, C1, expense, June`) is ~695 rows out of 50,000 (~1.4%). `EXPLAIN ANALYZE` (run inside
a `BEGIN…ROLLBACK`, without dirtying the DB):

**With the current composite index:**
```
Aggregate  (cost=863.72..863.73)  (actual time=0.318..0.319)
  -> Bitmap Heap Scan on transactions  (rows=695)
       -> Bitmap Index Scan on idx_tx_user_cat_nature_date  (rows=695)
Execution Time: 0.453 ms
```

**With a partial index added** (`... (user_id, category_id, transaction_date) WHERE nature='expense'`):
```
Aggregate  (cost=853.61..853.62)  (actual time=0.447..0.448)
  -> Bitmap Heap Scan on transactions  (rows=695)
       -> Bitmap Index Scan on idx_tx_expense_period  (rows=695)
Execution Time: 0.519 ms
```

| | Index used | Estimated cost | Actual execution |
| --- | --- | --- | --- |
| Current composite | `idx_tx_user_cat_nature_date` | 863.72 | 0.453 ms |
| + partial | `idx_tx_expense_period` | 853.61 | 0.519 ms |

The cost difference is ~1% and the real time is indistinguishable (measurement noise). Both plans
are a sub-millisecond Bitmap Index Scan.

## Recommendation

**Do NOT add the partial index now.** The composite index already covers the query and the planner uses it.
The only theoretical benefit of the partial one is **size** (it indexes only `expense` rows and omits `nature`
from the key), which only starts to matter at a much larger scale (millions of rows, where the storage
cost and the index's write amplification become relevant).

**Revisit if and only if:** the table grows to millions of rows AND monitoring shows that the
index size or write latency are a problem. At that point, measure with real data
before deciding.

## If it is added in the future (migration ready)

The partial index **cannot be declared with TypeORM 0.3's `@Index` decorator** (it doesn't model
partial indexes), so it would go as raw SQL in a migration — and remember it reintroduces
entity↔DB drift (the entity doesn't reflect it). SQL:

```sql
-- up()
CREATE INDEX idx_tx_expense_period
  ON transactions (user_id, category_id, transaction_date)
  WHERE nature = 'expense';

-- down()
DROP INDEX idx_tx_expense_period;
```

## Documentation actions (applied 2026-07-02)

The drift in three places that said "the index is missing / full-table scans":

1. **CLAUDE.md** → *Known gaps* section: ✅ rewritten as a "Resolved (was a gap)" note —
   the composite index exists; the partial one is an optional large-scale optimization.
2. **`transaction.orm.entity.ts`** (index comment): ✅ rewritten — the composite index
   covers the query; the partial one would only matter at millions of rows.
3. **`transactions/notes.md`**: ✅ verified — it does not repeat the "full-table scan"
   narrative; no change needed.
