-- ===========================================================================
-- SETUP (el "Gate" del plan).  Verificacion de que el lab esta en condiciones
-- de medir.
--
-- Por que existe: sin volumen y sin estadisticas frescas todo lo demas miente.
-- El planner no elige por lo que HAY en la tabla, elige por lo que pg_statistic
-- DICE que hay. Un catalogo desactualizado produce planes que parecen absurdos
-- y conclusiones que no son reproducibles.
--
-- Es idempotente y re-corrible. Volve a correrlo:
--   * despues de E4  (deja el catalogo mentiroso a proposito - ese es el punto
--                     del ejercicio, pero hay que limpiarlo antes de seguir)
--   * despues de cualquier re-seed (por ejemplo los 200k que necesita E17a)
--   * cuando un plan te sorprenda y no sepas si el problema es el query o las stats
--
-- Uso:   . .\scripts\pgq.ps1
--        pgq docs\perf\scripts\setup.sql
-- ===========================================================================

-- Paralelismo apagado en TODA medicion del lab. Un Gather/Gather Merge reparte
-- el trabajo entre workers y los buffers reportados dejan de ser comparables
-- entre corridas (dependen de cuantos workers consiguio esa vez). Se apaga para
-- leer planes, no porque este mal en produccion.
SET max_parallel_workers_per_gather = 0;


\echo ''
\echo '======== 0 - CONTEXTO DEL SERVIDOR ========'
-- track_io_timing DEBE decir "on" - sin eso, E3 no puede separar el tiempo de
-- I/O del tiempo de CPU y el ejercicio entero no tiene numero que mostrar.
SELECT version();
SHOW track_io_timing;
SHOW shared_buffers;
SHOW work_mem;
SHOW max_parallel_workers_per_gather;


\echo ''
\echo '======== G.2 - ANALYZE ========'
-- npm run populate ya corre ANALYZE al terminar (scripts/populate.mjs), asi que
-- justo despues de un seed esto es redundante. Vive aca igual porque el Gate
-- tiene que poder devolver la base a un estado medible sin re-seedear.
ANALYZE transactions;
ANALYZE accounts;
ANALYZE budgets;
ANALYZE categories;
ANALYZE users;


\echo ''
\echo '======== 1 - VOLUMEN: conteo real vs. reltuples ========'
-- CRITERIO: count(*) = 1.000.000 . reltuples cercano al real, NUNCA -1 ni 0.
-- Si esto da ~15.000 estas sobre el dataset viejo, con el que el planner elige
-- Seq Scan para casi cualquier parametro y E2/E3/E17 se quedan sin ejercicio.
-- Re-seedea: ver "Por que 1.000.000 y no 15.000" en docs/perf/README.md.
-- reltuples = -1 significa "nunca analizada" (PG >= 14). reltuples = 0 sobre una
-- tabla llena es peor: el planner cree que un Seq Scan cuesta nada.
SELECT count(*) AS filas_reales FROM transactions;

SELECT c.relname                                        AS tabla,
       c.reltuples::bigint                              AS reltuples_estimado,
       c.relpages                                       AS paginas,
       pg_size_pretty(pg_relation_size(c.oid))          AS heap,
       pg_size_pretty(pg_indexes_size(c.oid))           AS indices,
       pg_size_pretty(pg_total_relation_size(c.oid))    AS total
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('transactions', 'accounts', 'budgets', 'categories', 'users')
ORDER BY c.reltuples DESC;


\echo ''
\echo '======== 2 - FRESCURA DE LAS ESTADISTICAS ========'
-- CRITERIO: last_analyze (o last_autoanalyze) con timestamp reciente.
-- n_dead_tup ya importa aca: es lo que E7 (Heap Fetches) y E15/E16 (xmin
-- horizon, bloat) van a mover a proposito.
SELECT relname            AS tabla,
       n_live_tup         AS vivas,
       n_dead_tup         AS muertas,
       last_analyze,
       last_autoanalyze,
       last_vacuum,
       last_autovacuum
FROM pg_stat_user_tables
WHERE relname IN ('transactions', 'accounts', 'budgets', 'categories', 'users')
ORDER BY relname;


\echo ''
\echo '======== 3 - DISTRIBUCION POR USUARIO: top 10 ========'
-- CRITERIO: curva DECRECIENTE, no una meseta. Si todos los usuarios tienen
-- practicamente las mismas filas, `WHERE user_id = $1` es igual de selectivo
-- para cualquier $1 y no existe ningun parametro que empuje al planner de un
-- plan a otro -> E2 se hace por el camino B (fracciones por nature/mes).
--
-- Los user_id que salen aca son los PARAMETROS de E1/E2. Anotalos.
WITH total AS (SELECT count(*)::numeric AS n FROM transactions)
SELECT u.email,
       t.user_id,
       t.tx                                             AS transacciones,
       round(100.0 * t.tx / (SELECT n FROM total), 3)    AS pct_de_la_tabla
FROM (
    SELECT user_id, count(*) AS tx
    FROM transactions
    GROUP BY user_id
    ORDER BY count(*) DESC
    LIMIT 10
) t
JOIN users u ON u.id = t.user_id
ORDER BY t.tx DESC;

\echo ''
\echo '-------- 3b - DISTRIBUCION POR USUARIO: cola (5 mas chicos) --------'
-- El extremo opuesto del rango. La diferencia de fraccion entre el top 1 y estos
-- es exactamente lo que E2 explota: misma query, mismo plan disponible, decision
-- distinta del planner.
WITH total AS (SELECT count(*)::numeric AS n FROM transactions)
SELECT u.email,
       t.user_id,
       t.tx                                             AS transacciones,
       round(100.0 * t.tx / (SELECT n FROM total), 3)    AS pct_de_la_tabla
FROM (
    SELECT user_id, count(*) AS tx
    FROM transactions
    GROUP BY user_id
    ORDER BY count(*) ASC
    LIMIT 5
) t
JOIN users u ON u.id = t.user_id
ORDER BY t.tx ASC;

\echo ''
\echo '-------- 3c - RESUMEN DE LA CURVA --------'
WITH per_user AS (
    SELECT user_id, count(*) AS tx FROM transactions GROUP BY user_id
)
SELECT count(*)                                                        AS usuarios_con_tx,
       min(tx)                                                         AS minimo,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY tx)::numeric, 1) AS mediana,
       max(tx)                                                         AS maximo,
       round(max(tx)::numeric / nullif(min(tx), 0), 1)                  AS ratio_max_min
FROM per_user;


\echo ''
\echo '======== 4 - REPARTO POR nature ========'
-- CRITERIO: ~95% expense / ~5% income.
-- Ese 92% es el dato incomodo de E5: un indice parcial WHERE nature='expense'
-- excluye apenas el 8% de la tabla. NO se maquilla - se documenta que en este
-- dataset el valor del indice parcial no es el tamano sino la especializacion.
SELECT nature,
       count(*)                                                     AS filas,
       round(100.0 * count(*) / sum(count(*)) OVER (), 2)           AS pct
FROM transactions
GROUP BY nature
ORDER BY filas DESC;


\echo ''
\echo '======== 5 - RANGO TEMPORAL ========'
-- De donde salen el month/year que usan E1, E2 y E19. El mes actual esta
-- truncado al dia de hoy (el seed nunca genera fechas futuras), asi que para
-- medir conviene un mes CERRADO, no el corriente.
SELECT min(transaction_date)                                        AS mas_antigua,
       max(transaction_date)                                        AS mas_reciente,
       count(DISTINCT date_trunc('month', transaction_date))        AS meses_distintos
FROM transactions;

SELECT to_char(date_trunc('month', transaction_date), 'YYYY-MM')    AS mes,
       count(*)                                                     AS filas
FROM transactions
GROUP BY 1
ORDER BY 1;


\echo ''
\echo '======== 6 - pg_stats: lo que el planner CREE ========'
-- CRITERIO:
--   * n_distinct de user_id ~= cantidad de usuarios (negativo = fraccion de la tabla)
--   * correlation de transaction_date cercano a 1 -> el seed inserta ordenado por
--     fecha globalmente, asi que el orden fisico del heap sigue al logico. Eso
--     abarata los rangos por fecha y es la razon por la que E17b/E17c (keyset)
--     van a rendir de verdad.
--   * correlation de user_id cercano a 0 -> filas de un mismo usuario dispersas
--     por todo el heap, como en produccion. Es lo que hace CARO el random I/O de
--     un Index Scan y lo que le da sentido a E6 (Index Only Scan).
SELECT attname                        AS columna,
       n_distinct,
       round(correlation::numeric, 4) AS correlation,
       null_frac,
       avg_width
FROM pg_stats
WHERE schemaname = 'public'
  AND tablename  = 'transactions'
  AND attname IN ('user_id', 'category_id', 'account_id', 'nature', 'amount', 'transaction_date')
ORDER BY attname;


\echo ''
\echo '======== 7 - INDICES EXISTENTES: el punto de partida ========'
-- Anotar cuales hay YA. E5 y E6 agregan sobre esto, y E8 mide el costo de
-- escritura de este conjunto.
--
-- OJO con idx_tx_user_cat_nature_date (user_id, category_id, nature,
-- transaction_date): ya cubre la query de E1. El "antes" del Bloque 2 NO va a
-- ser un Seq Scan. Ver docs/perf/README.md.
SELECT i.indexrelname                                           AS indice,
       pg_size_pretty(pg_relation_size(i.indexrelid))           AS tamano,
       i.idx_scan                                               AS veces_usado,
       pg_get_indexdef(i.indexrelid)                            AS definicion
FROM pg_stat_user_indexes i
WHERE i.relname = 'transactions'
ORDER BY pg_relation_size(i.indexrelid) DESC;

\echo ''
\echo '-------- 7b - INDICES DEL RESTO DE LAS TABLAS --------'
SELECT relname AS tabla, indexrelname AS indice,
       pg_size_pretty(pg_relation_size(indexrelid)) AS tamano
FROM pg_stat_user_indexes
WHERE relname IN ('accounts', 'budgets', 'categories', 'users')
ORDER BY relname, indexrelname;


\echo ''
\echo '======== 8 - LA VIEW v_period_expenses ========'
-- CRITERIO: tiene que EXISTIR. Es la definicion unica de "que cuenta como gasto"
-- y la lee tanto GET /reports/summary como los 3 agregados de enforcement del UoW.
-- Una base construida con DB_SYNCHRONIZE=true NO la tiene (no hay entity detras);
-- solo la crea la migracion CreatePeriodExpensesView. Si esto devuelve 0 filas:
-- npm run migration:run.
SELECT viewname, definition
FROM pg_views
WHERE schemaname = 'public' AND viewname = 'v_period_expenses';

\echo ''
\echo '======== FIN DEL GATE ========'
