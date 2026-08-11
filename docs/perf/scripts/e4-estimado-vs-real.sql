SET max_parallel_workers_per_gather = 0;

\echo '======== E4.0 - CATALOGO ANTES ========'
SELECT reltuples::bigint AS reltuples, relpages FROM pg_class WHERE relname = 'transactions';
SELECT count(*) AS filas_en_el_periodo FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature = 'expense'
  AND transaction_date >= '2026-07-01' AND transaction_date < '2026-08-01';

BEGIN;

\echo '======== E4.1 - MEDICION ANTES DE INSERTAR ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

\echo '======== E4.2 - INSERTAR 5.000 FILAS CONCENTRADAS EN ESE MISMO PERIODO ========'
INSERT INTO transactions (id, user_id, account_id, category_id, nature, amount, description, transaction_date, created_at)
SELECT gen_random_uuid(),
       '7afba7e7-5856-4bd5-8cce-57887f4b1947',
       (SELECT id FROM accounts WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947' AND is_archived = false ORDER BY id LIMIT 1),
       '98de0404-ead4-4c77-9cb3-5875f282a936',
       'expense',
       1000,
       'E4 sintetica',
       TIMESTAMP '2026-07-15 00:00:00' + (g || ' seconds')::interval,
       now()
FROM generate_series(1, 5000) AS g;

\echo '======== E4.3 - MEDICION SIN ANALYZE (el catalogo todavia miente) ========'
SELECT reltuples::bigint AS reltuples_sin_analyze FROM pg_class WHERE relname = 'transactions';
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

\echo '======== E4.4 - ANALYZE ========'
ANALYZE transactions;
SELECT reltuples::bigint AS reltuples_post_analyze FROM pg_class WHERE relname = 'transactions';

\echo '======== E4.5 - MEDICION CON EL CATALOGO AL DIA ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT sum(amount) FROM transactions
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

ROLLBACK;

\echo '======== E4.6 - DESPUES DEL ROLLBACK: volvieron las estadisticas? ========'
SELECT count(*) AS filas_en_el_periodo FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature = 'expense'
  AND transaction_date >= '2026-07-01' AND transaction_date < '2026-08-01';
SELECT reltuples::bigint AS reltuples_post_rollback FROM pg_class WHERE relname = 'transactions';
EXPLAIN
SELECT sum(amount) FROM transactions
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';

\echo '======== E4.7 - LIMPIEZA OBLIGATORIA: dejar el catalogo sano ========'
ANALYZE transactions;
SELECT reltuples::bigint AS reltuples_final FROM pg_class WHERE relname = 'transactions';
EXPLAIN
SELECT sum(amount) FROM transactions
WHERE user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND nature           = 'expense'
  AND transaction_date >= '2026-07-01'
  AND transaction_date <  '2026-08-01';
