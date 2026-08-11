SET max_parallel_workers_per_gather = 0;

\echo '======== E16.0 - TAMANOS ANTES ========'
SELECT pg_relation_size('transactions')                        AS heap_bytes,
       pg_size_pretty(pg_relation_size('transactions'))        AS heap,
       pg_indexes_size('transactions')                         AS idx_bytes,
       pg_size_pretty(pg_indexes_size('transactions'))         AS indices;

SELECT indexrelname AS indice,
       pg_relation_size(indexrelid)                  AS bytes,
       pg_size_pretty(pg_relation_size(indexrelid))  AS tamano
FROM pg_stat_user_indexes WHERE relname = 'transactions'
ORDER BY pg_relation_size(indexrelid) DESC;

SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 2) AS pct_muertas
FROM pg_stat_user_tables WHERE relname = 'transactions';

\echo '======== E16.1 - VACUUM NORMAL ========'
VACUUM (VERBOSE) transactions;

\echo '======== E16.2 - TAMANOS DESPUES DEL VACUUM: bajaron? ========'
SELECT pg_relation_size('transactions')                 AS heap_bytes,
       pg_size_pretty(pg_relation_size('transactions')) AS heap,
       pg_indexes_size('transactions')                  AS idx_bytes,
       pg_size_pretty(pg_indexes_size('transactions'))  AS indices;

SELECT relname, n_live_tup, n_dead_tup FROM pg_stat_user_tables WHERE relname = 'transactions';

\echo '======== E16.3 - REINDEX CONCURRENTLY DE UN SOLO INDICE ========'
SELECT pg_relation_size('idx_tx_user_cat_nature_date') AS antes_bytes,
       pg_size_pretty(pg_relation_size('idx_tx_user_cat_nature_date')) AS antes;

REINDEX INDEX CONCURRENTLY idx_tx_user_cat_nature_date;

SELECT pg_relation_size('idx_tx_user_cat_nature_date') AS despues_bytes,
       pg_size_pretty(pg_relation_size('idx_tx_user_cat_nature_date')) AS despues;

\echo '======== E16.4 - REINDEX DEL RESTO ========'
REINDEX TABLE CONCURRENTLY transactions;

SELECT indexrelname AS indice,
       pg_relation_size(indexrelid)                  AS bytes,
       pg_size_pretty(pg_relation_size(indexrelid))  AS tamano
FROM pg_stat_user_indexes WHERE relname = 'transactions'
ORDER BY pg_relation_size(indexrelid) DESC;

\echo '======== E16.5 - EL HEAP SIGUE IGUAL: solo VACUUM FULL lo devuelve al SO ========'
SELECT pg_size_pretty(pg_relation_size('transactions'))        AS heap,
       pg_size_pretty(pg_indexes_size('transactions'))         AS indices,
       pg_size_pretty(pg_total_relation_size('transactions'))  AS total;

\echo '======== E16.6 - ANALYZE FINAL ========'
ANALYZE transactions;
