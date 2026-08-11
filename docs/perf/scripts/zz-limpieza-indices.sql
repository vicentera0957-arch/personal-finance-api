\echo '======== LIMPIEZA - devolver la tabla a los 3 indices del schema original ========'

DROP INDEX CONCURRENTLY IF EXISTS idx_tx_expense_period;
DROP INDEX CONCURRENTLY IF EXISTS idx_tx_expense_period_cover;
DROP INDEX CONCURRENTLY IF EXISTS idx_tx_mal_orden;
DROP INDEX CONCURRENTLY IF EXISTS idx_tx_user_date_id_keyset;

ALTER TABLE transactions RESET (autovacuum_enabled);

UPDATE transactions SET description = NULL
WHERE description IN ('e8-a', 'e13', 'e13-bis', 'e14-a', 'e15');

DELETE FROM transactions WHERE description LIKE 'lab-b3%'
                            OR description = 'E4 sintetica'
                            OR description = 'e8-insert';

VACUUM ANALYZE transactions;

\echo '-------- estado final: deben quedar 4 (PK + los 3 del schema) --------'
SELECT indexrelname AS indice,
       pg_size_pretty(pg_relation_size(indexrelid)) AS tamano,
       pg_get_indexdef(indexrelid)                  AS definicion
FROM pg_stat_user_indexes WHERE relname = 'transactions'
ORDER BY indexrelname;

SELECT count(*) AS filas_totales FROM transactions;
SELECT relname, reloptions FROM pg_class WHERE relname = 'transactions';
