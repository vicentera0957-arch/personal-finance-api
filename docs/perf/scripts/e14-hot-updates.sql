SET max_parallel_workers_per_gather = 0;

\echo '======== E14.0 - CONTADORES ANTES (reset para medir limpio) ========'
SELECT pg_stat_reset_single_table_counters('transactions'::regclass);
SELECT relname, n_tup_upd, n_tup_hot_upd, n_dead_tup
FROM pg_stat_user_tables WHERE relname = 'transactions';

\echo '======== E14.1 - UPDATE SOBRE COLUMNA **NO** INDEXADA (description) ========'
UPDATE transactions SET description = 'e14-a'
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS pct_hot,
       n_dead_tup
FROM pg_stat_user_tables WHERE relname = 'transactions';

\echo '======== E14.2 - RESET Y AHORA SOBRE COLUMNA **SI** INDEXADA (transaction_date) ========'
SELECT pg_stat_reset_single_table_counters('transactions'::regclass);

UPDATE transactions SET transaction_date = transaction_date + interval '1 second'
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS pct_hot,
       n_dead_tup
FROM pg_stat_user_tables WHERE relname = 'transactions';

\echo '======== E14.3 - DEVOLVER LAS FECHAS A SU VALOR ORIGINAL ========'
UPDATE transactions SET transaction_date = transaction_date - interval '1 second'
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND description      = 'e14-a'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-02';

\echo '======== E14.4 - TAMANOS: cuanto crecieron heap e indices ========'
SELECT pg_size_pretty(pg_relation_size('transactions')) AS heap,
       pg_size_pretty(pg_indexes_size('transactions'))  AS indices,
       pg_size_pretty(pg_total_relation_size('transactions')) AS total;

SELECT indexrelname AS indice, pg_size_pretty(pg_relation_size(indexrelid)) AS tamano
FROM pg_stat_user_indexes WHERE relname = 'transactions'
ORDER BY pg_relation_size(indexrelid) DESC;

\echo '======== E14.5 - ESPACIO LIBRE POR PAGINA: por que HOT a veces no se puede ========'
SELECT current_setting('block_size') AS block_size;
SELECT relname, relpages, reltuples::bigint,
       round(reltuples / nullif(relpages, 0), 1) AS filas_por_pagina
FROM pg_class WHERE relname = 'transactions';
