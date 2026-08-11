# PERFORMANCE

Narrativa del lab de performance de PostgreSQL. Los números crudos viven en
`docs/perf/salida/*.txt` y los experimentos que los produjeron en `docs/perf/scripts/*.sql`.
Este archivo **cita** esa evidencia, no la reemplaza.

**Dataset de todas las mediciones salvo aviso explícito:** 1.000.000 de
transacciones, 200 usuarios, 24 meses (2024-09 → 2026-08).
Gate: `docs/perf/salida/setup.txt`.

---

## §1 — Antes

### E1 · Baseline crudo

**Qué se midió:** el equivalente SQL de `sumExpenseAmountByUserCategoryAndPeriod`
([period-expenses.query.ts](src/shared/infrastructure/persistence/period-expenses.query.ts)),
la consulta que protege el invariante del presupuesto — la suma de gastos del
período que `CreateTransactionUseCase` corre bajo el `FOR UPDATE` de la fila de
budget, en cada gasto que se crea.

**Experimento:** `docs/perf/scripts/e1-baseline.sql`
**Salida cruda:** `docs/perf/salida/e1-baseline.txt`
**Fecha:** 2026-08-10

**Parámetros:**

- **`user_id`** — `7afba7e7-5856-4bd5-8cce-57887f4b1947` (`seed-load-user-1`).
  El usuario más grande del dataset: 212.817 tx, 21,3% de la tabla. Tiene volumen
  de sobra en cualquier mes.
- **`category_id`** — `98de0404-ead4-4c77-9cb3-5875f282a936` (Supermercado).
  4.029 filas en el período, 0,4% de la tabla; es la categoría con más volumen de
  ese usuario en el mes. Se descartaron `Arriendo` y `Servicios` (1 fila cada
  una): con un conjunto casi vacío el planner elige otra estrategia, y la foto
  sería de una consulta que en producción no existe.
- **Período** — `[2026-07-01, 2026-08-01)`. Mes cerrado. Agosto 2026 está
  truncado al día 10 (el seed no genera fechas futuras) y no es comparable.

**Sanity check:** `total = 170.301.625` sobre `4.029` filas. No es un conjunto
vacío, y el conteo queda corroborado de forma independiente por el
`actual rows=4029` del `Bitmap Heap Scan` en las tres corridas.

**La consulta, tal como se ejecutó:**

```sql
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM v_period_expenses e
WHERE e.user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';
```

`v_period_expenses` es una vista, no una tabla. Postgres la reescribe antes de
planificar, así que la sentencia que el planner realmente ve es:

```sql
SELECT COALESCE(SUM(e.amount), 0) AS total
FROM transactions e
WHERE e.nature           = 'expense'   -- ← aportado por la vista
  AND e.user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-07-01'
  AND e.transaction_date <  '2026-08-01';
```

Se midió la primera (la que emite la app), no la segunda. Que el plan nombre
`transactions` y no `v_period_expenses` es la evidencia de que la reescritura
ocurrió.

#### Mediciones

Tres corridas idénticas. **La 3 es la baseline.**

Las dos primeras no están para verificar que el plan se repite: el árbol de nodos
es una función determinista de la query, el catálogo, `pg_statistic` y las GUCs.
Congeladas esas cuatro cosas, el plan es idéntico ejecutes una vez o mil, y acá
ninguna se movió. Comprobarlo no costó nada y no probó nada.

Lo que las tres corridas dan es **la barra de error del tiempo**. Una sola
corrida entrega `3,585 ms` sin ninguna indicación de cuánto vale ese número; tres
muestran que la dispersión es de ~0,5 ms, un **15%**. Eso fija el piso de ruido
con el que hay que leer el Bloque 2: una mejora de 0,3 ms va a estar por debajo
de él y no significará nada. Un solo número no es una medición.

Ninguna de las tres es una medición en frío — las páginas ya estaban en el buffer
por la exploración previa, y `shared read = 0` en las tres lo confirma. La
medición en frío es E3, con reinicio del contenedor.

| Métrica        | Corrida 1        | Corrida 2        | Corrida 3 (**baseline**) |
| -------------- | ---------------- | ---------------- | ------------------------ |
| Nodo de acceso | Bitmap Heap Scan | Bitmap Heap Scan | Bitmap Heap Scan         |
| `cost=`        | 67.80..2882.33   | 67.80..2882.33   | 67.80..2882.33           |
| `rows=` est.   | 859              | 859              | 859                      |
| `actual rows=` | 4.029            | 4.029            | 4.029                    |
| `loops=`       | 1                | 1                | 1                        |
| `shared hit`   | 978              | 978              | 978                      |
| `shared read`  | 0                | 0                | 0                        |
| I/O Timings    | —                | —                | —                        |
| Planning Time  | 1,220 ms         | 0,157 ms         | 0,141 ms                 |
| Execution Time | 3,585 ms         | 3,160 ms         | 3,691 ms                 |

El plan completo, idéntico en las tres corridas:

```text
Aggregate  (cost=2884.48..2884.49 rows=1 width=8)
  Buffers: shared hit=978
  ->  Bitmap Heap Scan on transactions  (cost=67.80..2882.33 rows=859 width=4)
        Heap Blocks: exact=915
        Buffers: shared hit=978
        ->  Bitmap Index Scan on idx_tx_user_cat_nature_date  (cost=0.00..67.58 rows=859 width=0)
              Buffers: shared hit=63
```

> **Nodo de acceso** = el nodo que efectivamente toca la tabla (el de más abajo
> en el árbol), no el `Aggregate` de arriba. Es el que va a cambiar en el Bloque 2.

#### Observaciones

Hechos leídos de la salida. Sin interpretación: E1 no explica, registra.

- El plan nombra `transactions`, no `v_period_expenses`.
- `Recheck Cond` e `Index Cond` contienen **cinco** predicados, incluido
  `(nature)::text = 'expense'`, que no está escrito en la consulta.
- Los buffers son acumulativos: `Heap Blocks: exact=915` + índice `63` = `978`,
  el mismo `978` que reporta el `Aggregate`.
- `Heap Blocks` dice `exact`, sin componente `lossy`.
- `shared read` no aparece en ninguna de las tres corridas (= 0), y por eso
  tampoco hay línea `I/O Timings`.
- El planner estimó `rows=859`; salieron `4.029`. Subestimación de **4,7×**.
  Se persigue en E4.
- Las tres corridas coinciden en nodo, `cost=` y `rows=`.
- El `Planning Time` de la corrida 1 (1,220 ms) es ~8× el de las corridas 2 y 3
  (0,157 / 0,141 ms). Era una sesión psql recién abierta.
- El `Execution Time` no decrece monótonamente entre corridas
  (3,585 → 3,160 → 3,691 ms): el rango de variación es mayor que la diferencia
  entre corridas.

---

## §2 — Índices

<!-- Bloque 2 · E5–E8 -->

## §4 — Keyset pagination

<!-- Bloque 4 · E17a–c -->

## §5 — SQL analítico y joins

<!-- Bloque 5 · E19–E21 -->
