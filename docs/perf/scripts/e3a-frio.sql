SELECT id AS ballena FROM users WHERE email = 'seed-load-user-1@finanzas.dev' \gset
SELECT id AS categoria FROM categories WHERE user_id = :'ballena' AND name = 'Supermercado' AND nature = 'expense' \gset

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
