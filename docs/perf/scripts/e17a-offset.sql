SET max_parallel_workers_per_gather = 0;

\echo '======== E17a.0 - CUANTAS FILAS TIENE LA BALLENA ========'
SELECT count(*) AS filas FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947';

\echo '======== E17a.1 - OFFSET 0 ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount, description
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC
LIMIT 20 OFFSET 0;

\echo '======== E17a.2 - OFFSET 1000 ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount, description
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC
LIMIT 20 OFFSET 1000;

\echo '======== E17a.3 - OFFSET 10000 ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount, description
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC
LIMIT 20 OFFSET 10000;

\echo '======== E17a.4 - OFFSET 100000 ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount, description
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC
LIMIT 20 OFFSET 100000;

\echo '======== E17a.5 - OFFSET 200000 (casi el final) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount, description
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC
LIMIT 20 OFFSET 200000;
