SELECT user_id AS ballena FROM transactions GROUP BY user_id ORDER BY count(*) DESC LIMIT 1 \gset

SET max_parallel_workers_per_gather = 0;

\echo '======== E17a.0 - CUANTAS FILAS TIENE LA BALLENA ========'
SELECT count(*) AS filas FROM transactions
WHERE user_id = :'ballena';

\echo '======== E17a.1 - OFFSET 0 ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount, description
FROM transactions
WHERE user_id = :'ballena'
ORDER BY transaction_date DESC
LIMIT 20 OFFSET 0;

\echo '======== E17a.2 - OFFSET 1000 ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount, description
FROM transactions
WHERE user_id = :'ballena'
ORDER BY transaction_date DESC
LIMIT 20 OFFSET 1000;

\echo '======== E17a.3 - OFFSET 10000 ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount, description
FROM transactions
WHERE user_id = :'ballena'
ORDER BY transaction_date DESC
LIMIT 20 OFFSET 10000;

\echo '======== E17a.4 - OFFSET 100000 ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount, description
FROM transactions
WHERE user_id = :'ballena'
ORDER BY transaction_date DESC
LIMIT 20 OFFSET 100000;

\echo '======== E17a.5 - OFFSET 200000 (casi el final) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount, description
FROM transactions
WHERE user_id = :'ballena'
ORDER BY transaction_date DESC
LIMIT 20 OFFSET 200000;
