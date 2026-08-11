SET max_parallel_workers_per_gather = 0;

\echo '======== E2.0 - FRACCIONES REALES (contexto) ========'
SELECT 'total'                                  AS filtro, count(*) AS filas, 100.00 AS pct FROM transactions
UNION ALL
SELECT 'nature=expense',    count(*), round(100.0*count(*)/(SELECT count(*) FROM transactions), 3) FROM transactions WHERE nature = 'expense'
UNION ALL
SELECT 'nature=income',     count(*), round(100.0*count(*)/(SELECT count(*) FROM transactions), 3) FROM transactions WHERE nature = 'income'
UNION ALL
SELECT 'ballena (user-1)',  count(*), round(100.0*count(*)/(SELECT count(*) FROM transactions), 3) FROM transactions WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
UNION ALL
SELECT 'cola (user-200)',   count(*), round(100.0*count(*)/(SELECT count(*) FROM transactions), 3) FROM transactions WHERE user_id = '1141235c-9ea5-479c-bb45-de7c18e822f1'
UNION ALL
SELECT 'ballena+cat+mes',   count(*), round(100.0*count(*)/(SELECT count(*) FROM transactions), 3) FROM transactions WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947' AND category_id = '98de0404-ead4-4c77-9cb3-5875f282a936' AND nature = 'expense' AND transaction_date >= '2026-07-01' AND transaction_date < '2026-08-01';

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
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947';

\echo '======== E2.D - cola: user-200  (~0,063%) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id = '1141235c-9ea5-479c-bb45-de7c18e822f1';

\echo '======== E2.E - ballena + categoria + mes  (~0,4%) = la query de E1 ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

\echo '======== E2.F - cola + un mes  (fraccion mas chica todavia) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = '1141235c-9ea5-479c-bb45-de7c18e822f1'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

\echo '======== E2.G - forzando Seq Scan sobre el caso mas selectivo ========'
SET enable_indexscan = off;
SET enable_bitmapscan = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';
RESET enable_indexscan;
RESET enable_bitmapscan;
