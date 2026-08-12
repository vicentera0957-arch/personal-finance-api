SELECT user_id AS ballena FROM transactions GROUP BY user_id ORDER BY count(*) DESC LIMIT 1 \gset
SELECT category_id AS categoria FROM transactions WHERE user_id = :'ballena' AND nature = 'expense' AND transaction_date >= '2026-07-01' AND transaction_date < '2026-08-01' GROUP BY category_id ORDER BY count(*) DESC LIMIT 1 \gset

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
WHERE e.user_id          = :'ballena'
  AND e.category_id      = :'categoria'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E5.4 - MISMA QUERY FORZANDO EL INDICE VIEJO (comparacion) ========'
BEGIN;
DROP INDEX IF EXISTS idx_tx_expense_period;
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = :'ballena'
  AND e.category_id      = :'categoria'
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
WHERE e.user_id          = :'ballena'
  AND e.category_id      = :'categoria'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';
ROLLBACK;

DROP INDEX CONCURRENTLY IF EXISTS idx_tx_mal_orden;

\echo '======== E5.6 - ESTADO FINAL DE LOS INDICES ========'
SELECT indexrelname AS indice, pg_size_pretty(pg_relation_size(indexrelid)) AS tamano
FROM pg_stat_user_indexes WHERE relname = 'transactions'
ORDER BY pg_relation_size(indexrelid) DESC;
