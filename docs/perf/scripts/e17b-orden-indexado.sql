SET max_parallel_workers_per_gather = 0;

\echo '======== E17b.0 - EL INDICE QUE PODRIA ENTREGAR EL ORDEN ========'
SELECT indexrelname AS indice, pg_get_indexdef(indexrelid) AS definicion
FROM pg_stat_user_indexes WHERE relname = 'transactions'
ORDER BY indexrelname;

\echo '======== E17b.1 - ORDER BY transaction_date DESC: hay nodo Sort? ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC
LIMIT 20;

\echo '======== E17b.2 - ORDER BY transaction_date ASC (el indice esta en ASC) ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date ASC
LIMIT 20;

\echo '======== E17b.3 - ORDER BY amount DESC: ningun indice lo entrega ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY amount DESC
LIMIT 20;

\echo '======== E17b.4 - LO MISMO SIN LIMIT: el Sort tiene que consumir todo ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY amount DESC;

\echo '======== E17b.5 - EL DESEMPATE QUE FALTA: (fecha) no es unico ========'
SELECT count(*) AS timestamps_repetidos
FROM (
    SELECT transaction_date
    FROM transactions
    WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
    GROUP BY transaction_date
    HAVING count(*) > 1
) x;

SELECT sum(n) AS filas_con_fecha_ambigua
FROM (
    SELECT count(*) AS n
    FROM transactions
    WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
    GROUP BY transaction_date
    HAVING count(*) > 1
) y;

\echo '======== E17b.6 - ORDER BY con desempate: cambia el plan? ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, transaction_date, amount
FROM transactions
WHERE user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
ORDER BY transaction_date DESC, id DESC
LIMIT 20;
