SET max_parallel_workers_per_gather = 0;

\echo '======== E7.0 - VISIBILITY MAP ANTES ========'
SELECT relname, relpages, relallvisible,
       round(100.0 * relallvisible / nullif(relpages, 0), 2) AS pct_all_visible
FROM pg_class WHERE relname = 'transactions';

SELECT relname, n_live_tup, n_dead_tup, last_vacuum, last_autovacuum
FROM pg_stat_user_tables WHERE relname = 'transactions';

\echo '======== E7.1 - MEDICION CON EL VM LIMPIO (Heap Fetches deberia ser 0) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E7.2 - APAGAR AUTOVACUUM EN LA TABLA (si no, limpia solo) ========'
ALTER TABLE transactions SET (autovacuum_enabled = false);

\echo '======== E7.3 - ENSUCIAR: reescribir las 4.029 filas del periodo ========'
UPDATE transactions SET description = description
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

\echo '======== E7.4 - VISIBILITY MAP DESPUES DE ENSUCIAR ========'
SELECT relname, relpages, relallvisible,
       round(100.0 * relallvisible / nullif(relpages, 0), 2) AS pct_all_visible
FROM pg_class WHERE relname = 'transactions';
SELECT relname, n_live_tup, n_dead_tup FROM pg_stat_user_tables WHERE relname = 'transactions';

\echo '======== E7.5 - MISMA QUERY: cuanto subio Heap Fetches ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';
