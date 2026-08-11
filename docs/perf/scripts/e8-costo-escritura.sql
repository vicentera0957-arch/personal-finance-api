SET max_parallel_workers_per_gather = 0;

\echo '======== E8.0 - INDICES VIGENTES ========'
SELECT indexrelname AS indice,
       pg_size_pretty(pg_relation_size(indexrelid)) AS tamano,
       pg_get_indexdef(indexrelid)                  AS definicion
FROM pg_stat_user_indexes WHERE relname = 'transactions'
ORDER BY pg_relation_size(indexrelid) DESC;

\echo '======== E8.1 - UPDATE sobre columna NO indexada (description) ========'
BEGIN;
EXPLAIN (ANALYZE, BUFFERS)
UPDATE transactions SET description = 'e8-a'
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';
ROLLBACK;

\echo '======== E8.2 - UPDATE sobre columna INDEXADA (transaction_date) ========'
BEGIN;
EXPLAIN (ANALYZE, BUFFERS)
UPDATE transactions SET transaction_date = transaction_date + interval '1 second'
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';
ROLLBACK;

\echo '======== E8.3 - EL MISMO UPDATE INDEXADO, PERO SIN LOS INDICES DE E5/E6 ========'
BEGIN;
DROP INDEX IF EXISTS idx_tx_expense_period;
DROP INDEX IF EXISTS idx_tx_expense_period_cover;
EXPLAIN (ANALYZE, BUFFERS)
UPDATE transactions SET transaction_date = transaction_date + interval '1 second'
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';
ROLLBACK;

\echo '======== E8.4 - EL MISMO UPDATE SIN NINGUN INDICE SALVO LA PK ========'
BEGIN;
DROP INDEX IF EXISTS idx_tx_expense_period;
DROP INDEX IF EXISTS idx_tx_expense_period_cover;
DROP INDEX IF EXISTS idx_tx_user_cat_nature_date;
DROP INDEX IF EXISTS idx_tx_user_date;
DROP INDEX IF EXISTS idx_tx_account_date;
EXPLAIN (ANALYZE, BUFFERS)
UPDATE transactions SET transaction_date = transaction_date + interval '1 second'
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';
ROLLBACK;

\echo '======== E8.5 - INSERT masivo: mismo contraste ========'
BEGIN;
EXPLAIN (ANALYZE, BUFFERS)
INSERT INTO transactions (id, user_id, account_id, category_id, nature, amount, description, transaction_date, created_at)
SELECT gen_random_uuid(),
       '7afba7e7-5856-4bd5-8cce-57887f4b1947',
       (SELECT id FROM accounts WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947' AND is_archived = false ORDER BY id LIMIT 1),
       '98de0404-ead4-4c77-9cb3-5875f282a936',
       'expense', 1000, 'e8-insert',
       TIMESTAMP '2026-07-15 00:00:00' + (g || ' seconds')::interval,
       now()
FROM generate_series(1, 20000) AS g;
ROLLBACK;

BEGIN;
DROP INDEX IF EXISTS idx_tx_expense_period;
DROP INDEX IF EXISTS idx_tx_expense_period_cover;
DROP INDEX IF EXISTS idx_tx_user_cat_nature_date;
DROP INDEX IF EXISTS idx_tx_user_date;
DROP INDEX IF EXISTS idx_tx_account_date;
EXPLAIN (ANALYZE, BUFFERS)
INSERT INTO transactions (id, user_id, account_id, category_id, nature, amount, description, transaction_date, created_at)
SELECT gen_random_uuid(),
       '7afba7e7-5856-4bd5-8cce-57887f4b1947',
       (SELECT id FROM accounts WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947' AND is_archived = false ORDER BY id LIMIT 1),
       '98de0404-ead4-4c77-9cb3-5875f282a936',
       'expense', 1000, 'e8-insert',
       TIMESTAMP '2026-07-15 00:00:00' + (g || ' seconds')::interval,
       now()
FROM generate_series(1, 20000) AS g;
ROLLBACK;

\echo '======== E8.6 - VERIFICAR QUE LOS ROLLBACK DEVOLVIERON TODO ========'
SELECT indexrelname AS indice, pg_size_pretty(pg_relation_size(indexrelid)) AS tamano
FROM pg_stat_user_indexes WHERE relname = 'transactions'
ORDER BY indexrelname;
SELECT count(*) AS filas_totales FROM transactions;
