SELECT user_id AS ballena FROM transactions GROUP BY user_id ORDER BY count(*) DESC LIMIT 1 \gset
SELECT category_id AS categoria FROM transactions WHERE user_id = :'ballena' AND nature = 'expense' AND transaction_date >= '2026-07-01' AND transaction_date < '2026-08-01' GROUP BY category_id ORDER BY count(*) DESC LIMIT 1 \gset

SET max_parallel_workers_per_gather = 0;

\echo '======== E7.6 - VACUUM (no puede ir dentro de una transaccion) ========'
VACUUM (VERBOSE) transactions;

\echo '======== E7.7 - VISIBILITY MAP DESPUES DEL VACUUM ========'
SELECT relname, relpages, relallvisible,
       round(100.0 * relallvisible / nullif(relpages, 0), 2) AS pct_all_visible
FROM pg_class WHERE relname = 'transactions';
SELECT relname, n_live_tup, n_dead_tup, last_vacuum
FROM pg_stat_user_tables WHERE relname = 'transactions';

\echo '======== E7.8 - MISMA QUERY: Heap Fetches volvio a 0? ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = :'ballena'
  AND e.category_id      = :'categoria'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';

\echo '======== E7.9 - REACTIVAR AUTOVACUUM (obligatorio: no dejar la tabla sin mantenimiento) ========'
ALTER TABLE transactions RESET (autovacuum_enabled);
SELECT relname, reloptions FROM pg_class WHERE relname = 'transactions';
