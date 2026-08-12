SELECT user_id AS ballena FROM transactions GROUP BY user_id ORDER BY count(*) DESC LIMIT 1 \gset
SELECT category_id AS categoria FROM transactions WHERE user_id = :'ballena' AND nature = 'expense' AND transaction_date >= '2026-07-01' AND transaction_date < '2026-08-01' GROUP BY category_id ORDER BY count(*) DESC LIMIT 1 \gset

SET max_parallel_workers_per_gather = 0;

\echo '======== 0 - SANITY CHECK ========'
SELECT COALESCE(SUM(e.amount), 0) AS total,
       count(*)                   AS filas
FROM v_period_expenses e
WHERE e.user_id          = :'ballena'
  AND e.category_id      = :'categoria'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E1 - CORRIDA 1 ========'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = :'ballena'
  AND e.category_id      = :'categoria'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E1 - CORRIDA 2 ========'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = :'ballena'
  AND e.category_id      = :'categoria'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E1 - CORRIDA 3 (BASELINE) ========'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = :'ballena'
  AND e.category_id      = :'categoria'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';
