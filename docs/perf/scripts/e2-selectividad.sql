SELECT user_id AS ballena FROM transactions GROUP BY user_id ORDER BY count(*) DESC LIMIT 1 \gset
SELECT category_id AS categoria FROM transactions WHERE user_id = :'ballena' AND nature = 'expense' AND transaction_date >= '2026-07-01' AND transaction_date < '2026-08-01' GROUP BY category_id ORDER BY count(*) DESC LIMIT 1 \gset
SELECT user_id AS cola FROM transactions GROUP BY user_id ORDER BY count(*) ASC LIMIT 1 \gset

SET max_parallel_workers_per_gather = 0;

\echo '======== E2.0 - FRACCIONES REALES (contexto) ========'
SELECT 'total'                                  AS filtro, count(*) AS filas, 100.00 AS pct FROM transactions
UNION ALL
SELECT 'nature=expense',    count(*), round(100.0*count(*)/(SELECT count(*) FROM transactions), 3) FROM transactions WHERE nature = 'expense'
UNION ALL
SELECT 'nature=income',     count(*), round(100.0*count(*)/(SELECT count(*) FROM transactions), 3) FROM transactions WHERE nature = 'income'
UNION ALL
SELECT 'ballena (user-1)',  count(*), round(100.0*count(*)/(SELECT count(*) FROM transactions), 3) FROM transactions WHERE user_id = :'ballena'
UNION ALL
SELECT 'cola (user-200)',   count(*), round(100.0*count(*)/(SELECT count(*) FROM transactions), 3) FROM transactions WHERE user_id = :'cola'
UNION ALL
SELECT 'ballena+cat+mes',   count(*), round(100.0*count(*)/(SELECT count(*) FROM transactions), 3) FROM transactions WHERE user_id = :'ballena' AND category_id = :'categoria' AND nature = 'expense' AND transaction_date >= '2026-07-01' AND transaction_date < '2026-08-01';

\echo '======== E2.A - nature = expense  (~94,6%) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE nature = 'expense';

\echo '======== E2.B - nature = income  (~5,4%) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE nature = 'income';

\echo '======== E2.C - ballena: user-1  (~21,3%) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id = :'ballena';

\echo '======== E2.D - cola: user-200  (~0,063%) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id = :'cola';

\echo '======== E2.E - ballena + categoria + mes  (~0,4%) = la query de E1 ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = :'ballena'
  AND category_id      = :'categoria'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

\echo '======== E2.F - cola + un mes  (fraccion mas chica todavia) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = :'cola'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

\echo '======== E2.G - forzando Seq Scan sobre el caso mas selectivo ========'
SET enable_indexscan = off;
SET enable_bitmapscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = :'ballena'
  AND category_id      = :'categoria'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';
RESET enable_indexscan;
RESET enable_bitmapscan;
