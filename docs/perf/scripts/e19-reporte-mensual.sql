SELECT user_id AS ballena FROM transactions GROUP BY user_id ORDER BY count(*) DESC LIMIT 1 \gset

SET max_parallel_workers_per_gather = 0;

\echo '======== E19.1 - REPORTE MENSUAL: CTEs + window functions ========'
WITH gasto_mensual AS (
    SELECT date_trunc('month', t.transaction_date)::date AS mes,
           c.id                                          AS category_id,
           c.name                                        AS categoria,
           sum(t.amount)                                 AS gasto,
           count(*)                                      AS movimientos
    FROM transactions t
    JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = :'ballena'
      AND t.nature  = 'expense'
    GROUP BY 1, 2, 3
),
con_ventanas AS (
    SELECT mes, category_id, categoria, gasto, movimientos,
           sum(gasto)  OVER (PARTITION BY category_id ORDER BY mes
                             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado,
           lag(gasto)  OVER (PARTITION BY category_id ORDER BY mes)            AS mes_anterior,
           row_number() OVER (PARTITION BY mes ORDER BY gasto DESC)            AS puesto,
           sum(gasto)  OVER (PARTITION BY mes)                                 AS total_del_mes
    FROM gasto_mensual
)
SELECT mes,
       puesto,
       categoria,
       gasto,
       round(100.0 * gasto / nullif(total_del_mes, 0), 1)                     AS pct_del_mes,
       acumulado,
       mes_anterior,
       gasto - mes_anterior                                                    AS delta,
       round(100.0 * (gasto - mes_anterior) / nullif(mes_anterior, 0), 1)     AS pct_cambio
FROM con_ventanas
WHERE puesto <= 3
ORDER BY mes DESC, puesto
LIMIT 36;

\echo '======== E19.2 - EL MISMO REPORTE CONTRA EL PRESUPUESTO (3 tablas) ========'
WITH gasto_mensual AS (
    SELECT date_trunc('month', t.transaction_date)::date AS mes,
           t.category_id,
           sum(t.amount)                                 AS gasto
    FROM transactions t
    WHERE t.user_id = :'ballena'
      AND t.nature  = 'expense'
    GROUP BY 1, 2
)
SELECT g.mes,
       c.name                                                        AS categoria,
       g.gasto,
       b.amount_limit                                                AS limite,
       g.gasto - b.amount_limit                                      AS exceso,
       round(100.0 * g.gasto / nullif(b.amount_limit, 0), 1)         AS pct_usado
FROM gasto_mensual g
JOIN categories c ON c.id = g.category_id
LEFT JOIN budgets b
       ON b.user_id     = :'ballena'
      AND b.category_id = g.category_id
      AND b.year        = extract(year  FROM g.mes)::int
      AND b.month       = extract(month FROM g.mes)::int
ORDER BY g.mes DESC, g.gasto DESC
LIMIT 40;

\echo '======== E19.3 - PLAN DEL REPORTE COMPLETO ========'
EXPLAIN (ANALYZE, BUFFERS)
WITH gasto_mensual AS (
    SELECT date_trunc('month', t.transaction_date)::date AS mes,
           t.category_id,
           sum(t.amount)                                 AS gasto
    FROM transactions t
    WHERE t.user_id = :'ballena'
      AND t.nature  = 'expense'
    GROUP BY 1, 2
)
SELECT g.mes, c.name, g.gasto, b.amount_limit,
       sum(g.gasto) OVER (PARTITION BY g.category_id ORDER BY g.mes) AS acumulado,
       lag(g.gasto) OVER (PARTITION BY g.category_id ORDER BY g.mes) AS mes_anterior
FROM gasto_mensual g
JOIN categories c ON c.id = g.category_id
LEFT JOIN budgets b
       ON b.user_id     = :'ballena'
      AND b.category_id = g.category_id
      AND b.year        = extract(year  FROM g.mes)::int
      AND b.month       = extract(month FROM g.mes)::int;

\echo '======== E19.4 - LA VERSION INGENUA: traer todo a la app y sumar en Node ========'
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.id, t.category_id, t.amount, t.transaction_date
FROM transactions t
WHERE t.user_id = :'ballena'
  AND t.nature  = 'expense';
