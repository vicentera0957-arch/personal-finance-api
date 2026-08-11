SET max_parallel_workers_per_gather = 0;

\echo '======== E3.0 - CONTEXTO ========'
SHOW track_io_timing;
SHOW shared_buffers;
SELECT pg_size_pretty(pg_relation_size('transactions'))  AS heap,
       pg_size_pretty(pg_indexes_size('transactions'))   AS indices;

\echo '======== E3.1 - FRIA: primera ejecucion tras reiniciar el contenedor ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

\echo '======== E3.2 - FRIA sobre un conjunto grande (ballena entera, ~21%) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947';
