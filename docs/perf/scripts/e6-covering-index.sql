SELECT user_id AS ballena FROM transactions GROUP BY user_id ORDER BY count(*) DESC LIMIT 1 \gset
SELECT category_id AS categoria FROM transactions WHERE user_id = :'ballena' AND nature = 'expense' AND transaction_date >= '2026-07-01' AND transaction_date < '2026-08-01' GROUP BY category_id ORDER BY count(*) DESC LIMIT 1 \gset

SET max_parallel_workers_per_gather = 0;

\echo '======== E6.0 - LINEA BASE: el plan que dejo E5 ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = :'ballena'
  AND e.category_id      = :'categoria'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E6.1 - CREAR EL COVERING INDEX (INCLUDE amount) ========'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_expense_period_cover
  ON transactions (user_id, category_id, transaction_date)
  INCLUDE (amount)
  WHERE nature = 'expense';

ANALYZE transactions;

\echo '======== E6.2 - TAMANO: cuanto cuesta el INCLUDE ========'
SELECT indexrelname AS indice,
       pg_size_pretty(pg_relation_size(indexrelid)) AS tamano,
       pg_relation_size(indexrelid)                 AS bytes,
       pg_get_indexdef(indexrelid)                  AS definicion
FROM pg_stat_user_indexes
WHERE relname = 'transactions'
  AND indexrelname IN ('idx_tx_expense_period', 'idx_tx_expense_period_cover');

\echo '======== E6.3 - LA MISMA QUERY: aparece Index Only Scan? ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = :'ballena'
  AND e.category_id      = :'categoria'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E6.4 - QUERY QUE ROMPE EL INDEX ONLY (pide una columna fuera del indice) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(SUM(e.amount), 0) AS total, count(DISTINCT t.account_id) AS cuentas
FROM v_period_expenses e
JOIN transactions t ON t.id = e.id
WHERE e.user_id          = :'ballena'
  AND e.category_id      = :'categoria'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E6.5 - INCLUDE NO SIRVE PARA BUSCAR: filtrar por amount ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*) FROM v_period_expenses e
WHERE e.user_id          = :'ballena'
  AND e.category_id      = :'categoria'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01'
  AND e.amount > 20000;
