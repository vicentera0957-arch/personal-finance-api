SET max_parallel_workers_per_gather = 0;

\echo '======== E17c.0 - EL BUG DE CORRECTITUD DE OFFSET (antes de la performance) ========'
CREATE TEMP TABLE pagina_a AS
SELECT id FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC
LIMIT 20 OFFSET 1000;

SET enable_indexscan = off;
SET enable_bitmapscan = off;
CREATE TEMP TABLE pagina_b AS
SELECT id FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC
LIMIT 20 OFFSET 1000;
RESET enable_indexscan;
RESET enable_bitmapscan;

SELECT (SELECT count(*) FROM (SELECT id FROM pagina_a EXCEPT SELECT id FROM pagina_b) x) AS solo_en_a,
       (SELECT count(*) FROM (SELECT id FROM pagina_b EXCEPT SELECT id FROM pagina_a) y) AS solo_en_b;

DROP TABLE pagina_a;
DROP TABLE pagina_b;

\echo '======== E17c.1 - INDICE PARA KEYSET: con desempate por id ========'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_user_date_id_keyset
  ON transactions (user_id, transaction_date DESC, id DESC);
ANALYZE transactions;

SELECT indexrelname AS indice, pg_size_pretty(pg_relation_size(indexrelid)) AS tamano
FROM pg_stat_user_indexes WHERE relname = 'transactions'
ORDER BY indexrelname;

\echo '======== E17c.2 - TOMAR EL CURSOR DE LA FILA 10.000 ========'
SELECT transaction_date AS cur_date, id AS cur_id
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC, id DESC
OFFSET 10000 LIMIT 1
\gset

\echo 'cursor ->'
\echo :cur_date
\echo :cur_id

\echo '======== E17c.3 - OFFSET 10000 (el metodo viejo) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC, id DESC
LIMIT 20 OFFSET 10000;

\echo '======== E17c.4 - KEYSET desde el mismo punto ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND (transaction_date, id) < (:'cur_date'::timestamp, :'cur_id'::uuid)
ORDER BY transaction_date DESC, id DESC
LIMIT 20;

\echo '======== E17c.5 - KEYSET EN LA PAGINA 1 (sin cursor) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC, id DESC
LIMIT 20;

\echo '======== E17c.6 - EL COSTO NO DEPENDE DE LA PROFUNDIDAD: cursor en la fila 200.000 ========'
SELECT transaction_date AS far_date, id AS far_id
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC, id DESC
OFFSET 200000 LIMIT 1
\gset

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND (transaction_date, id) < (:'far_date'::timestamp, :'far_id'::uuid)
ORDER BY transaction_date DESC, id DESC
LIMIT 20;

\echo '======== E17c.7 - COMPARACION FINAL: mismo destino, dos metodos ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC, id DESC
LIMIT 20 OFFSET 200000;
