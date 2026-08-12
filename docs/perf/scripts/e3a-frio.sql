SELECT user_id AS ballena FROM transactions GROUP BY user_id ORDER BY count(*) DESC LIMIT 1 \gset
SELECT category_id AS categoria FROM transactions WHERE user_id = :'ballena' AND nature = 'expense' AND transaction_date >= '2026-07-01' AND transaction_date < '2026-08-01' GROUP BY category_id ORDER BY count(*) DESC LIMIT 1 \gset

SET max_parallel_workers_per_gather = 0;

\echo '======== E3.0 - CONTEXTO ========'
SHOW track_io_timing;
SHOW shared_buffers;
SELECT pg_size_pretty(pg_relation_size('transactions'))  AS heap,
       pg_size_pretty(pg_indexes_size('transactions'))   AS indices;

\echo '======== E3.1 - FRIA: primera ejecucion tras reiniciar el contenedor ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = :'ballena'
  AND category_id      = :'categoria'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

\echo '======== E3.2 - FRIA sobre un conjunto grande (ballena entera, ~21%) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id = :'ballena';
