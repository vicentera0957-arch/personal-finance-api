SELECT user_id AS ballena FROM transactions GROUP BY user_id ORDER BY count(*) DESC LIMIT 1 \gset
SELECT category_id AS categoria FROM transactions WHERE user_id = :'ballena' AND nature = 'expense' AND transaction_date >= '2026-07-01' AND transaction_date < '2026-08-01' GROUP BY category_id ORDER BY count(*) DESC LIMIT 1 \gset

SET max_parallel_workers_per_gather = 0;

\echo '======== E13.0 - ELEGIR UNA FILA CONCRETA ========'
SELECT id AS fila_id
FROM transactions
WHERE user_id          = :'ballena'
  AND category_id      = :'categoria'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01'
ORDER BY id
LIMIT 1
\gset

\echo 'fila elegida ->'
\echo :fila_id

\echo '======== E13.1 - LAS COLUMNAS DE SISTEMA ========'
SELECT ctid, xmin, xmax, amount, description
FROM transactions WHERE id = :'fila_id'::uuid;

\echo '======== E13.2 - CINCO FILAS VECINAS: los ctid son consecutivos ========'
SELECT ctid, xmin, xmax, transaction_date
FROM transactions
WHERE user_id          = :'ballena'
  AND category_id      = :'categoria'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01'
ORDER BY id
LIMIT 5;

BEGIN;

\echo '======== E13.3 - LA TRANSACCION ACTUAL ========'
SELECT txid_current() AS mi_txid;

\echo '======== E13.4 - ANTES DEL UPDATE ========'
SELECT ctid, xmin, xmax FROM transactions WHERE id = :'fila_id'::uuid;

\echo '======== E13.5 - UPDATE ========'
UPDATE transactions SET description = 'e13' WHERE id = :'fila_id'::uuid;

\echo '======== E13.6 - DESPUES DEL UPDATE: cambio el ctid ========'
SELECT ctid, xmin, xmax FROM transactions WHERE id = :'fila_id'::uuid;

\echo '======== E13.7 - SEGUNDO UPDATE EN LA MISMA TRANSACCION ========'
UPDATE transactions SET description = 'e13-bis' WHERE id = :'fila_id'::uuid;
SELECT ctid, xmin, xmax FROM transactions WHERE id = :'fila_id'::uuid;

\echo '======== E13.8 - UN DELETE: donde queda marcado ========'
DELETE FROM transactions WHERE id = :'fila_id'::uuid;
SELECT count(*) AS la_ve_esta_transaccion FROM transactions WHERE id = :'fila_id'::uuid;

ROLLBACK;

\echo '======== E13.9 - DESPUES DEL ROLLBACK ========'
SELECT ctid, xmin, xmax, description FROM transactions WHERE id = :'fila_id'::uuid;

\echo '======== E13.10 - CUANTAS VERSIONES MUERTAS DEJO TODO ESTO ========'
SELECT relname, n_live_tup, n_dead_tup FROM pg_stat_user_tables WHERE relname = 'transactions';
