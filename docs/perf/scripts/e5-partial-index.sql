SET max_parallel_workers_per_gather = 0;

\echo '======== E5.0 - INDICES ANTES ========'
SELECT indexrelname AS indice,
       pg_size_pretty(pg_relation_size(indexrelid)) AS tamano,
       idx_scan AS veces_usado
FROM pg_stat_user_indexes WHERE relname = 'transactions'
ORDER BY pg_relation_size(indexrelid) DESC;

\echo '======== E5.1 - CREAR EL INDICE PARCIAL (CONCURRENTLY, sin BEGIN) ========'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_expense_period
  ON transactions (user_id, category_id, transaction_date)
  WHERE nature = 'expense';

ANALYZE transactions;

\echo '======== E5.2 - TAMANOS: parcial vs. completo ========'
SELECT indexrelname AS indice,
       pg_size_pretty(pg_relation_size(indexrelid)) AS tamano,
       pg_relation_size(indexrelid)                 AS bytes
FROM pg_stat_user_indexes WHERE relname = 'transactions'
ORDER BY pg_relation_size(indexrelid) DESC;

\echo '======== E5.3 - RE-MEDIR LA QUERY DE E1 ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E5.4 - MISMA QUERY FORZANDO EL INDICE VIEJO (comparacion) ========'
BEGIN;
DROP INDEX IF EXISTS idx_tx_expense_period;
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';
ROLLBACK;

\echo '======== E5.5 - LA COLUMNA DE RANGO VA ULTIMA: contraejemplo ========'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_mal_orden
  ON transactions (transaction_date, user_id, category_id)
  WHERE nature = 'expense';
ANALYZE transactions;

BEGIN;
DROP INDEX IF EXISTS idx_tx_expense_period;
DROP INDEX IF EXISTS idx_tx_user_cat_nature_date;
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';
ROLLBACK;

DROP INDEX CONCURRENTLY IF EXISTS idx_tx_mal_orden;

\echo '======== E5.6 - ESTADO FINAL DE LOS INDICES ========'
SELECT indexrelname AS indice, pg_size_pretty(pg_relation_size(indexrelid)) AS tamano
FROM pg_stat_user_indexes WHERE relname = 'transactions'
ORDER BY pg_relation_size(indexrelid) DESC;
