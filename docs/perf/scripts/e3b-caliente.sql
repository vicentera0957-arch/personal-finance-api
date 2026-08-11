SET max_parallel_workers_per_gather = 0;

\echo '======== E3.3 - CALIENTE 1 (query chica) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

\echo '======== E3.4 - CALIENTE 2 (query chica) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

\echo '======== E3.5 - CALIENTE 1 (query grande, ballena entera) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947';

\echo '======== E3.6 - CALIENTE 2 (query grande, ballena entera) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947';

\echo '======== E3.7 - QUE HAY EN EL CACHE AHORA ========'
SELECT relname                                             AS tabla,
       heap_blks_read                                      AS bloques_de_disco,
       heap_blks_hit                                       AS bloques_de_memoria,
       round(100.0 * heap_blks_hit /
             nullif(heap_blks_hit + heap_blks_read, 0), 2) AS pct_hit
FROM pg_statio_user_tables
WHERE relname = 'transactions';
