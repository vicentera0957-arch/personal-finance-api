SET max_parallel_workers_per_gather = 0;

\echo '======== E20.0 - TAMANOS DE LOS TRES LADOS DEL JOIN ========'
SELECT relname AS tabla, n_live_tup AS filas FROM pg_stat_user_tables
WHERE relname IN ('transactions', 'categories', 'budgets')
ORDER BY n_live_tup DESC;

\echo '======== E20.1 - PLAN LIBRE (el planner elige) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, c.name, b.amount_limit
FROM transactions t
JOIN categories c ON c.id = t.category_id
LEFT JOIN budgets b
       ON b.category_id = t.category_id
      AND b.user_id     = t.user_id
      AND b.year        = extract(year  FROM t.transaction_date)::int
      AND b.month       = extract(month FROM t.transaction_date)::int
WHERE t.user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND t.nature  = 'expense'
  AND t.transaction_date >= '2026-07-01'
  AND t.transaction_date <  '2026-08-01';

\echo '======== E20.2 - SIN HASH JOIN ========'
SET enable_hashjoin = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, c.name, b.amount_limit
FROM transactions t
JOIN categories c ON c.id = t.category_id
LEFT JOIN budgets b
       ON b.category_id = t.category_id
      AND b.user_id     = t.user_id
      AND b.year        = extract(year  FROM t.transaction_date)::int
      AND b.month       = extract(month FROM t.transaction_date)::int
WHERE t.user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND t.nature  = 'expense'
  AND t.transaction_date >= '2026-07-01'
  AND t.transaction_date <  '2026-08-01';
RESET enable_hashjoin;

\echo '======== E20.3 - SIN NESTED LOOP ========'
SET enable_nestloop = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, c.name, b.amount_limit
FROM transactions t
JOIN categories c ON c.id = t.category_id
LEFT JOIN budgets b
       ON b.category_id = t.category_id
      AND b.user_id     = t.user_id
      AND b.year        = extract(year  FROM t.transaction_date)::int
      AND b.month       = extract(month FROM t.transaction_date)::int
WHERE t.user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND t.nature  = 'expense'
  AND t.transaction_date >= '2026-07-01'
  AND t.transaction_date <  '2026-08-01';
RESET enable_nestloop;

\echo '======== E20.4 - SIN MERGE JOIN ========'
SET enable_mergejoin = off;
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, c.name, b.amount_limit
FROM transactions t
JOIN categories c ON c.id = t.category_id
LEFT JOIN budgets b
       ON b.category_id = t.category_id
      AND b.user_id     = t.user_id
      AND b.year        = extract(year  FROM t.transaction_date)::int
      AND b.month       = extract(month FROM t.transaction_date)::int
WHERE t.user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND t.nature  = 'expense'
  AND t.transaction_date >= '2026-07-01'
  AND t.transaction_date <  '2026-08-01';
RESET enable_mergejoin;

\echo '======== E20.5 - EL MISMO JOIN CON EL LADO GRANDE (24 meses, no 1) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*), sum(t.amount)
FROM transactions t
JOIN categories c ON c.id = t.category_id
LEFT JOIN budgets b
       ON b.category_id = t.category_id
      AND b.user_id     = t.user_id
      AND b.year        = extract(year  FROM t.transaction_date)::int
      AND b.month       = extract(month FROM t.transaction_date)::int
WHERE t.nature = 'expense';

\echo '======== E20.6 - CONFIRMAR QUE NO QUEDO NINGUN enable_* APAGADO ========'
SELECT name, setting FROM pg_settings
WHERE name IN ('enable_hashjoin', 'enable_mergejoin', 'enable_nestloop',
               'enable_indexscan', 'enable_bitmapscan', 'enable_seqscan')
ORDER BY name;
