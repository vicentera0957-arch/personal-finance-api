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


### E2 · La selectividad decide, no el volumen

**Experimento:** `docs/perf/scripts/e2-selectividad.sql`
**Salida cruda:** `docs/perf/salida/e2-selectividad.txt`
**Fechas:** 2026-08-11 (A–G) · 2026-08-12 (mediciones de seguimiento)

> ⚠️ **Procedencia.** A–G se midieron antes de que la suite de integración
> truncara la tabla (ver la nota de incidente al pie). El re-seed posterior
> generó UUID nuevos, así que los identificadores del `.txt` ya no existen —
> los scripts ahora derivan sus parámetros con `\gset` y sobreviven cualquier
> re-seed. Los **conteos son idénticos**: el reparto Pareto es determinista.

#### Mediciones

Siete filtros, misma forma de consulta (`SELECT sum(amount) … WHERE …`), del
94,6% al 0,003% de la tabla.

| | Filtro | Filas | % filas | Nodo | `cost` | Páginas |
| --- | --- | --- | --- | --- | --- | --- |
| A | `nature='expense'` | 946.001 | 94,60% | **Seq Scan** | 31.946 | 17.084 |
| B | `nature='income'` | 53.999 | 5,40% | **Seq Scan** | 29.722 | 16.440 |
| C | ballena | 212.817 | 21,28% | Bitmap Heap | 29.537 | 17.084 |
| D | cola | 626 | 0,063% | Bitmap Heap | 2.883 | 616 |
| E | ballena+cat+mes | 4.029 | 0,403% | Bitmap Heap | 2.954 | 915 |
| F | cola+mes | 34 | 0,003% | Bitmap Heap | 194 | 33 |
| G | E con Seq forzado | 4.029 | 0,403% | Seq Scan (forzado) | 39.586 | 17.084 |

#### ¿Están agrupadas o dispersas? El modelo de urnas

La pregunta correcta no es "cuántas páginas tocó" sino **"cuántas habría tocado
si estas filas estuvieran tiradas al azar por la tabla"**. Es el problema de
urnas: `n` filas en `m = 17.084` páginas ocupan

```text
páginas esperadas = m × (1 − (1 − 1/m)ⁿ)
```

| | Filas | Esperado si fuera azar | Real | Real ÷ esperado |
| --- | --- | --- | --- | --- |
| B `income` | 53.999 | 16.360 | 16.440 | **1,00** |
| C ballena | 212.817 | 17.084 | 17.084 | **1,00** |
| D cola | 626 | 615 | 616 | **1,00** |
| E ballena+cat+mes | 4.029 | 3.589 | **915** | **0,25** |
| F cola+mes | 34 | 34 | 33 | (n muy chico, no discrimina) |

Tres filtros distintos, tres veces **1,00**: `income`, la ballena y la cola están
*exactamente* tan dispersos como el azar puro. **E es el único que rompe el
patrón** — cuatro veces mejor — y la única diferencia es que filtra por
`transaction_date`, la columna en cuyo orden está escrita la tabla. Ese filtro no
recorta filas: **recorta una franja física**.

> Reemplaza a la métrica `páginas ÷ (filas ÷ 58)` que usaba una versión anterior
> de esta sección. Aquélla mezclaba volumen con agrupamiento; el modelo de urnas
> los separa porque compara contra el nulo correcto.

#### `correlation`, columna por columna

```text
transaction_date   1.000     ← la tabla está escrita en orden de fecha
nature             0.902
user_id            0.070     ← ninguna
category_id        0.018     ← ninguna
```

`correlation` es un número **por columna**, no por predicado, y solo es legible
en alta cardinalidad: `nature` marca 0,902 pero sus dos valores se comportan al
revés uno del otro. Postgres **no tiene** *clustering factor*.

#### Por qué E no eligió Index Scan

`btcostestimate()` calcula la correlación de un índice mirando **solo su columna
líder**. De `idx_tx_user_cat_nature_date` la líder es `user_id` = **0,070**;
`cost_index()` hace `csquared = correlation²` ≈ 0,005 y cobra las páginas casi a
`random_page_cost` puro. Forzando el Index Scan:

| Plan | `cost` | Tiempo | Buffers |
| --- | --- | --- | --- |
| Bitmap (elegido) | **2.864** | 2,113 ms | 981 |
| Index Scan forzado | 3.395 | 2,369 ms | **982** |

**981 contra 982 buffers: el mismo trabajo.** El planner creyó que el Index Scan
era 18,6% peor y en la práctica es un empate, porque dentro del grupo
`(user, cat, expense)` el índice **sí** está en orden de fecha y la tabla
también. La correlación real del tramo escaneado es excelente; el planner solo
ve la global de la columna líder.

#### Por qué C perdió: el pool, no el I/O aleatorio

C eligió Bitmap por **2,7%** de margen (28.797 contra 29.584 en el nodo de scan)
y **perdió por 13%** en tiempo real. Las estadísticas no tuvieron nada que ver:
estimó 211.200 filas contra 212.817 reales, 0,76% de error.

El planner **no afirmó** que iba a leer menos páginas — le puso 17.084 × 1,0 a
los dos caminos. Lo único que creyó ganar fue no evaluar `user_id = X` sobre las
787.183 filas que no le sirven (9.810), a cambio de leer el índice (9.020).

Medido tres rondas alternadas:

| | Bitmap | Seq Scan |
| --- | --- | --- |
| `cost` | **28.797** | 29.584 |
| Tiempo | 108,9 / 111,7 ms | **98,8 / 94,1 ms** |
| Buffers `hit` | **32** | **16.349** |
| Buffers `read` | **18.933** | **735** |
| I/O | 36,6 / 33,2 ms | **1,4 / 1,1 ms** |

Contenido del pool después de cada plan, vía `pg_buffercache`:

```text
tras BITMAP     bloques 812 → 17083   (16.272 páginas)
tras SEQ SCAN   bloques 812 → 17083   (16.272 páginas)   ← idéntico
```

El Seq Scan leyó 735 páginas del disco y **no movió un solo buffer del pool**.
Eso es el *ring buffer*: Postgres escanea secuencialmente cualquier tabla mayor
a `shared_buffers/4` a través de un anillo de 256 KB = 32 buffers, sin desalojar
el resto. El Bitmap Heap Scan **no usa ring**, así que desaloja — y como

```text
tabla          17.084 páginas
shared_buffers 16.384 páginas   ← no cabe, por un 4%
```

el acceso cíclico sobre un working set 4% mayor que el caché **desaloja siempre
la página que va a pedir a continuación**. Hit rate 0,2% contra 95,7%: el caso
patológico clásico de LRU. Mismas páginas, 25× el I/O.

**No fue I/O aleatorio.** El bitmap leyó 0→17.083 en orden físico perfecto.

#### Por qué G se quedó corto

El planner predijo que el Bitmap era **13,8×** más barato que el Seq Scan
forzado; fue **63,8×** más rápido (2,113 ms contra 134,867 ms). Acertó la
dirección y subestimó la magnitud casi 5×.

| | Modelo | Realidad |
| --- | --- | --- |
| I/O (17.084 páginas) | 17.084 = **43%** | 36,5 ms = **27%** |
| CPU (1M filas × 5 quals) | 22.500 = **57%** | 98,4 ms = **73%** |

```text
36,489 ms ÷ 17.084 páginas  = 2,136 µs por página
98,378 ms ÷ 1.000.000 filas = 0,098 µs por fila
                              ratio real   22 : 1
                              ratio modelo 100 : 1   (seq_page_cost ÷ cpu_tuple_cost)
```

El modelo sobrevalora el I/O ~4,6× respecto de la CPU — casi exactamente el
factor por el que se quedó corto. **El pecado real del Seq Scan no es leer
17.084 páginas: es tocar 1.000.000 de filas para tirar 995.972**, y ese trabajo
lo tarifa al precio más barato que tiene. `seq_page_cost=1.0` y
`random_page_cost=4.0` son defaults calibrados para discos que giraban.

#### Conclusiones

**1 · La unidad de costo es la página, no la fila.** 8 KB, ~58 filas. No existe
leer una fila sola.

**2 · Hay dos selectividades y solo la de páginas cuesta.** `income` es el 5,4%
de las filas y el 96,2% de las páginas.

**3 · Para saber si algo está agrupado, comparalo contra el azar** con el modelo
de urnas. B, C y D dan 1,00; E da 0,25.

**4 · Filtrar por la columna físicamente ordenada recorta páginas; por cualquier
otra, solo recorta filas.** Es toda la diferencia entre D y E.

**5 · `correlation` es por columna, y un índice compuesto se juzga por su
columna líder.** Un índice cuya líder está desordenada se ve mal aunque el tramo
real esté perfectamente agrupado.

**6 · La selectividad solo decide entre los caminos que existen.** B no eligió
Seq Scan: ningún índice tiene `nature` como primera columna.

**7 · El planner no elige estrategias: compara dos números y toma el menor.** Sin
umbral y sin noción de margen de error. C ganó por 2,7% y perdió por 13%.

**8 · El modelo no conoce el caché.** Cobra I/O que puede estar en RAM, y no
modela que un Bitmap Heap Scan desaloja el pool mientras un Seq Scan usa un ring
de 32 buffers.

**9 · El ratio I/O:CPU del modelo (100:1) no es el de la máquina (22:1).** Cuando
una consulta pierde por tocar millones de filas, el modelo lo subestima.

**10 · El planner nunca aprende de la ejecución.** `EXPLAIN ANALYZE` muestra
estimado y real lado a lado, pero esa comparación no se guarda. `ANALYZE` corrige
la distribución de valores, jamás el agrupamiento ni el estado del caché.

Las constantes que decodifican cualquier costo:

```text
seq_page_cost = 1.0 · random_page_cost = 4.0
cpu_tuple_cost = 0.01 · cpu_operator_cost = 0.0025
```

Verificado sobre A/B (`17.084 + 1.000.000×0,01 + 1.000.000×0,0025 = 29.584`,
exacto) y sobre G, que con cuatro condiciones extra suma justo
`1.000.000×0,0025×4 = 10.000` más.

> **Nota de incidente (2026-08-11).** Entre esta corrida y la siguiente, la
> tabla apareció vacía. Firma: `TRUNCATE` de las cinco tablas de
> `test/helpers/db-cleaner.ts`, con `n_tup_del = 0` en todas y `migrations`
> intacta. `ConfigModule.forRoot()` en `src/app.module.ts` no declara
> `envFilePath`, así que cae a `.env` — la base de trabajo — si la suite de
> integración corre sin `--env-file=test/.env.test`.

---

## §2 — Índices

<!-- Bloque 2 · E5–E8 -->

## §4 — Keyset pagination

<!-- Bloque 4 · E17a–c -->

## §5 — SQL analítico y joins

<!-- Bloque 5 · E19–E21 -->
