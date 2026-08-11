SET max_parallel_workers_per_gather = 0;

\echo '======== 0 - SANITY CHECK ========'
SELECT COALESCE(SUM(e.amount), 0) AS total,
       count(*)                   AS filas
FROM v_period_expenses e
WHERE e.user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E1 - CORRIDA 1 ========'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E1 - CORRIDA 2 ========'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E1 - CORRIDA 3 (BASELINE) ========'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';
