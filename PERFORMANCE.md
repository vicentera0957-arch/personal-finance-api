# PERFORMANCE

Narrativa del lab de performance de PostgreSQL. Los números crudos viven en
`docs/perf/salida/*.txt` y los experimentos que los produjeron en `docs/perf/scripts/*.sql`.
Este archivo **cita** esa evidencia, no la reemplaza.

**Dataset de todas las mediciones salvo aviso explícito:** 1.000.000 de
transacciones, 200 usuarios, 24 meses (2024-09 → 2026-08).
Gate: `docs/perf/salida/setup.txt`.

---

## Qué encontró este lab

El detalle de abajo es largo a propósito — la regla que gobierna todo esto es que
un `EXPLAIN` sin su salida cruda es una afirmación sin respaldo. Los cuatro
hallazgos, para quien no va a leer las 500 líneas:

- **El planner elige por fracción, no por volumen.** La misma consulta pasa de
  Index Scan a Bitmap Heap a Seq Scan **solo cambiando el `user_id`** — del
  0,003% al 94,6% de la tabla, sin tocar una letra del SQL.
  ([E2](#e2--la-selectividad-decide-no-el-volumen))
- **Los buffers son el invariante; los milisegundos son el ruido.** Mismo trabajo
  (982 buffers), **29× de diferencia en tiempo** según de dónde salieron las
  páginas. Y `shared read` no significa disco: significa "no estaba en
  `shared_buffers`". ([E3](#e3--leer-buffers-no-milisegundos))
- **La causa número uno de una mala estimación no son las estadísticas viejas.**
  Es la independencia que el planner asume entre columnas. Erraba 4,7× y
  `ANALYZE` no podía arreglarlo; `CREATE STATISTICS` lo bajó a 3,3%.
  ([E4](#e4--estimado-vs-real))
- **El índice que protege el invariante del presupuesto ya estaba bien.** La
  consulta que corre bajo el `FOR UPDATE` de `CreateTransaction` resuelve en
  sub-milisegundo sobre 1.000.000 de filas. ([E1](#e1--baseline-crudo))

- **La única forma de bajar las páginas de heap es no ir al heap.** Un índice
  mejor optimiza el camino y compra 3%; un índice que contiene todo lo que la
  consulta pide elimina el destino y compra **96%** — de 982 buffers a 37.
  ([E6](#e6--covering-index--index-only-scan))
- **El índice del schema está 43% inflado**, y no por uso: `InitialSchema` lo crea
  antes de que existan los datos, así que se llena por page splits. El bloat
  costaba **20× más buffers que la optimización que estaba probando**.
  ([E5](#e5--índice-parcial))

**Lo que salió de acá para el producto:** `CREATE STATISTICS` sobre
`(user_id, category_id, nature)` es un candidato real de migración — ver el
cierre de E4.

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

> **Procedencia.** A–G se midieron antes de que la suite de integración
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

### E3 · Leer buffers, no milisegundos

**Experimentos:** `docs/perf/scripts/e3a-frio.sql` · `e3b-caliente.sql`
**Salida cruda:** `docs/perf/salida/e3a-frio.txt` · `e3b-caliente.txt`
**Fecha:** 2026-08-12 · `track_io_timing = on` · `shared_buffers = 128 MB`
· heap 133 MB · índices 289 MB

> El preámbulo `\gset` de estos dos scripts deriva sus parámetros de `users`
> (5 páginas) y `categories` (23), **no** de `transactions`. Un `GROUP BY
> user_id` sobre el millón de filas habría calentado el caché justo antes de la
> medición fría y destruido el ejercicio.

#### Query chica — 982 buffers

| | `hit` | `read` | I/O | Execution |
| --- | --- | --- | --- | --- |
| fría (tras `restart`) | 0 | **982** | 75,6 ms | **83,5 ms** |
| caliente 1 | 919 | 63 | 0,4 ms | 3,3 ms |
| caliente 2 | **982** | 0 | — | **2,9 ms** |

**El total es 982 en las tres.** Lo único que cambia es de dónde salieron las
páginas. **29× de diferencia en tiempo, cero diferencia en trabajo** — y el I/O
explica el 90% de la corrida fría (75,6 de 83,5 ms).

#### Query grande — 18.965 buffers

| | `hit` | `read` | I/O | Execution | µs/página |
| --- | --- | --- | --- | --- | --- |
| fría | 0 | **18.965** | 1.193,7 ms | **1.338,5 ms** | 62,9 |
| caliente 1 | 919 | **18.046** | 140,8 ms | 235,7 ms | 7,8 |
| caliente 2 | 919 | **18.046** | 29,5 ms | **100,6 ms** | **1,6** |

**Acá está el hallazgo de E3.** La corrida "caliente" **nunca deja de leer**:
18.046 páginas de disco, idéntico en las dos, para siempre. Es el mismo
mecanismo de C en E2 — 18.965 páginas de working set contra 16.384 de pool, un
Bitmap Heap Scan que se auto-desaloja.

Y sin embargo **el tiempo baja 13×** leyendo exactamente las mismas páginas.
`shared read` no significa "fue al disco": significa **"no estaba en
`shared_buffers`"**. Debajo está el page cache del kernel, que sirve esas mismas
páginas **40× más rápido** (62,9 → 1,6 µs). Dos capas de caché, y el plan solo
reporta la primera.

#### Conclusiones

**1 · Los buffers son el invariante; los milisegundos son el ruido.** Mismo
trabajo, 29× de spread. Una query que toca 18.965 buffers es cara hoy, mañana y
en producción.

**2 · `read` no es disco.** Es un fallo de `shared_buffers`, no necesariamente
I/O físico. `I/O Timings` distingue una cosa de la otra: 62,9 µs/página es disco,
1,6 µs/página es page cache del SO.

**3 · Hay working sets que nunca se cachean.** Si el conjunto supera
`shared_buffers` y el nodo no usa ring buffer, el hit rate se queda clavado
—4,8% acá— por muchas veces que se repita la query.

---

### E4 · Estimado vs. real

**Experimento:** `docs/perf/scripts/e4-estimado-vs-real.sql`
**Salida cruda:** `docs/perf/salida/e4-estimado-vs-real.txt`
**Fecha:** 2026-08-12

Dentro de `BEGIN`/`ROLLBACK`: medir, insertar 5.000 filas en el mismo período,
medir sin `ANALYZE`, correr `ANALYZE`, medir.

| Paso | `reltuples` | Filas reales | `rows=` est. | `actual rows` | Error |
| --- | --- | --- | --- | --- | --- |
| E4.1 antes | 1.000.000 | 4.028 | **852** | 4.028 | **4,7×** |
| E4.3 sin `ANALYZE` | 1.000.000 | 9.028 | **856** | 9.028 | **10,5×** |
| E4.5 con `ANALYZE` | 1.005.000 | 9.028 | **980** | 9.028 | **9,2×** |
| E4.6 tras `ROLLBACK` | **1.005.000** | 4.028 | 856 | — | — |
| E4.7 tras `ANALYZE` final | 1.000.000 | 4.028 | 853 | — | 4,7× |

#### 1 · Sin `ANALYZE` la estimación igual se movió, pero 0,5% cuando la realidad se movió 124%

852 → 856. El planner **no** usa `pg_class.reltuples` tal cual:
`estimate_rel_size()` lee el **tamaño real del archivo** al planificar y escala
`reltuples` proporcionalmente. Por eso un plan cambia cuando la tabla crece
aunque nadie haya corrido `ANALYZE`, y por eso el ajuste es de volumen, nunca de
**forma**.

#### 2 · El `ROLLBACK` revierte las filas y no revierte todo el catálogo

`reltuples` quedó en **1.005.000** con 1.000.000 de filas reales. `ANALYZE`
escribe `pg_class.reltuples`/`relpages` con `heap_inplace_update`, que **no es
transaccional** — es así a propósito, para no generar bloat de catálogo.

`pg_statistic` sí revirtió: con `reltuples` y tamaño de archivo idénticos a
E4.5, la estimación volvió de 980 a **856**, el valor previo al `ANALYZE`. La
única variable que cambió es la distribución. **Las dos mitades del catálogo se
comportan distinto ante un rollback**, y por eso el `ANALYZE` final del script es
obligatorio, no higiene.

#### 3 · El error de 4,7× no lo causó el experimento: ya estaba ahí

`ANALYZE` mejoró de 856 a 980 sobre 9.028 reales. Sigue errando 9×, porque el
error de base es anterior a cualquier inserción. El planner **multiplica
selectividades asumiendo independencia entre columnas**:

```text
0,2128 (user) x 0,0744 (cat) x 0,946 (nature) x 0,0543 (mes) x 1M = 814
el planner dijo 852 · la realidad es 4.028
```

Pero `Supermercado` **de esta ballena** pertenece solo a esta ballena:
`P(user | category) = 1`, no 0,2128. Multiplicar por `P(user)` sobra, y la
cuenta cierra exacta: `4.028 x 0,2128 = 857 ≈ 852`.

`ANALYZE` **no puede** arreglar esto: corrige la distribución de cada columna por
separado, y el problema es la **relación entre** columnas. La herramienta es otra:

```sql
CREATE STATISTICS stx_tx_user_cat (dependencies, ndistinct)
  ON user_id, category_id, nature FROM transactions;
ANALYZE transactions;
```

| | `rows=` estimado | Real | Error |
| --- | --- | --- | --- |
| sin estadísticas extendidas | 853 | 4.028 | **4,7×** |
| con `CREATE STATISTICS` | **4.161** | 4.028 | **3,3%** |

Verificado y luego revertido (`DROP STATISTICS`) para no contaminar el baseline
del Bloque 2. **Candidato real de migración**, ver la acción pendiente abajo.

#### Conclusiones

**1 · La estimación se mueve con el tamaño del archivo, no solo con `ANALYZE`.**
El planner lee el archivo en vivo y escala; `ANALYZE` aporta la *forma* de los
datos.

**2 · `ROLLBACK` no revierte `pg_class`.** Sí revierte `pg_statistic`. Después de
cualquier experimento que inserte y deshaga, `ANALYZE` es obligatorio.

**3 · La causa #1 de mala estimación no son las estadísticas viejas: es la
independencia asumida entre columnas.** Se detecta comparando `rows=` con
`actual rows`, y se arregla con `CREATE STATISTICS`, no corriendo `ANALYZE` más
seguido.

> **Acción pendiente para el producto.** `sumExpenseAmountByUserCategoryAndPeriod`
> filtra por `(user_id, category_id, nature, período)`, tres columnas
> funcionalmente dependientes. El planner subestima 4,7× ese predicado. Hoy no
> duele porque elige el plan correcto igual, pero es exactamente el error que
> hace colapsar un plan cuando la query gana un `JOIN`: con una estimación de 853
> filas un Nested Loop parece razonable; con 4.028, no.

---

## §2 — Índices

Los dos ejercicios de este bloque atacan el mismo número desde lados opuestos: las
**919 páginas de heap** que E1 dejó como piso.

| | Nodo | índice | heap | **total** | vs. E1 |
| --- | --- | --- | --- | --- | --- |
| **E1** baseline | Bitmap Heap Scan | 63 | 919 | **982** | — |
| **E5** índice parcial | Bitmap Heap Scan | 31 | 919 | **950** | −3,3% |
| **E6** covering index | **Index Only Scan** | **37** | **0** | **37** | **−96,2%** |

### E5 · Índice parcial

**Experimento:** `docs/perf/scripts/e5-partial-index.sql`
**Salida cruda:** `docs/perf/salida/e5-partial-index.txt`
**Fecha:** 2026-08-12

```sql
CREATE INDEX CONCURRENTLY idx_tx_expense_period
  ON transactions (user_id, category_id, transaction_date)
  WHERE nature = 'expense';
```

#### El resultado, y la variable que lo estaba contaminando

A primera vista el índice parcial parecía una mejora del 53% en tamaño (114 MB → 53 MB) y
del 50% en páginas de índice leídas (63 → 31). **Los dos números mezclaban dos causas.**
Un tercer índice de control —completo, pero construido *después* de los datos— las separa:

| Índice | Tamaño | Páginas de índice leídas | Buffers totales |
| --- | --- | --- | --- |
| **A** parcial, construido ahora | 53 MB | **31** | **950** |
| **B** completo, construido ahora | 65 MB | **36** | 955 |
| **C** completo, del schema | 114 MB | **138** | 1.057 |

- **A contra B** — eso es el índice parcial: **5 páginas, 14%**.
- **B contra C** — eso es **bloat**: 102 páginas, **3,8×**.

**El índice parcial ahorró 5 buffers de 982 (0,5%). El bloat costaba 102.**

La causa del bloat es que `InitialSchema` crea los índices **antes** de que existan los
datos, así que se llenan por inserción: cada página se parte al medio y queda al ~50-70%
de ocupación. Un `CREATE INDEX` sobre datos ya presentes ordena y llena al 90%.

> Corolario práctico: restaurar esta base desde un dump dejaría los índices 43% más
> chicos, porque `pg_restore` los crea después de los datos.

El 18% de diferencia de tamaño entre A y B cierra con la teoría:

```text
entrada del parcial:  8(header) + 16 + 16 + 8      = 48 bytes
entrada del completo: 8 + 16 + 16 + 8(nature) + 8  = 56 bytes
48/56 × 0,946 (5,4% menos filas) = 0,81  →  19% más chico
medido: 18%
```

#### El contraejemplo: igualdades primero, rango último

Mismo predicado, mismas 4.028 filas, orden de columnas invertido:

| Índice | Nodo | páginas de índice | buffers | `cost` |
| --- | --- | --- | --- | --- |
| `(user, cat, fecha)` | Bitmap | **31** | **950** | 2.691 |
| `(fecha, user, cat)` | Index Scan | **~383** | 1.290 | 3.823 |

Los dos planes muestran las tres condiciones en `Index Cond`, y **no las usan igual**:

```text
Bueno:  user=X ∧ cat=Y  →  salta al tramo del índice  →  lee julio de ESE grupo
Malo:   fecha ∈ julio   →  salta al tramo de julio    →  lee TODO julio (54.000 filas
                                                          de 200 usuarios) y filtra
```

**En un B-tree, desde la primera columna de rango las siguientes dejan de posicionar y
solo filtran.** Es la distinción *access predicate* vs *filter predicate*, y son 12× de
diferencia en páginas de índice.

#### Conclusiones

**1 · Un índice cambia cómo encontrás las filas, nunca dónde están.** Con el costo
dominado por el heap (97%), el mejor índice posible da 3%.

**2 · Igualdades primero, rango último.** `idx_tx_user_cat_nature_date` ya lo respetaba.

**3 · Un índice parcial vale por especialización, no por tamaño.** Excluir el 5,4% no
compra nada; sacar `nature` de la clave sí (entradas 14% más angostas).

**4 · Cuándo construís un índice cambia su tamaño 43%.**

**5 · Toda mejora necesita un control.** Sin el índice B, la conclusión habría sido
"el índice parcial mejoró 50%" — falsa, con evidencia real al lado.

---

### E6 · Covering index → Index Only Scan

**Experimento:** `docs/perf/scripts/e6-covering-index.sql`
**Salida cruda:** `docs/perf/salida/e6-covering-index.txt`
**Fecha:** 2026-08-12

```sql
CREATE INDEX CONCURRENTLY idx_tx_expense_period_cover
  ON transactions (user_id, category_id, transaction_date)
  INCLUDE (amount)
  WHERE nature = 'expense';
```

#### El resultado

| | Nodo | buffers | `cost` | Tiempo |
| --- | --- | --- | --- | --- |
| E5 (índice parcial) | Bitmap Heap Scan | **950** | 2.924 | 22,4 ms |
| E6 (covering) | **Index Only Scan** | **37** | **68,8** | **0,87 ms** |

**25,7× menos buffers.** Las 919 páginas de heap desaparecieron por completo:

```text
Index Only Scan using idx_tx_expense_period_cover
  Heap Fetches: 0
  Buffers: shared hit=37
```

El costo estimado cayó de 2.924 a 68,8 — **42×**. Es el único ejercicio del lab donde el
planner y la realidad coinciden en la magnitud.

**Qué costó:** 53 MB → **61 MB**, un 15% más de índice. `amount` es un `int4`: 4 bytes por
entrada sobre ~946.000 entradas.

#### `INCLUDE` no sirve para buscar — la prueba

Agregar `AND amount > 20000` al predicado:

```text
Index Only Scan using idx_tx_expense_period_cover
  Filter: (amount > 20000)        ← Filter, NO Index Cond
  Rows Removed by Filter: 352
  Heap Fetches: 0
  Buffers: shared hit=37
```

`amount` está en el índice —por eso `Heap Fetches` sigue en 0— pero aparece como
**`Filter`**, no como `Index Cond`. Leyó las 4.028 entradas y descartó 352 después. Una
columna en la clave habría posicionado el scan; una en `INCLUDE` solo evita el heap.

Ese es exactamente el trade-off: las columnas incluidas **no engordan los nodos internos
del árbol**, porque solo viven en las hojas. Pagás espacio en las hojas, no profundidad.

#### Qué pasa cuando la query pide algo fuera del índice

E6.4 agrega `count(DISTINCT account_id)`, una columna que el índice no tiene:

| | buffers | Tiempo |
| --- | --- | --- |
| Index Only Scan (E6.3) | **37** | 0,87 ms |
| pidiendo `account_id` (E6.4) | **17.062** | **810 ms** |

461× más buffers. Y el plan muestra por qué:

```text
Index Scan using PK on transactions t  (actual rows=1 loops=4028)
  Buffers: shared hit=13359 read=2753
```

**`loops=4028`.** Un Nested Loop que va al heap una vez por fila, por primary key. Es un
N+1 dentro de un solo `SELECT` — el mismo patrón que E21 busca en el ORM, acá visible en
el plan.

#### Conclusiones

**1 · La única forma de bajar las páginas de heap es no ir al heap.** E5 optimizó el
camino y ganó 3%; E6 eliminó el destino y ganó 96%.

**2 · Un índice es un covering index respecto de una query, no en abstracto.** Basta que
la query pida una columna de más para volver a los 17.000 buffers.

**3 · `INCLUDE` evita el heap, no posiciona el scan.** Se ve en el plan: `Filter` en vez
de `Index Cond`.

**4 · `Heap Fetches: 0` no es gratis ni permanente.** Depende del visibility map, y eso
es E7.

---

## En curso

El bloque 1 está cerrado: E1–E4 cubren cómo se lee un plan y qué mueve de verdad
al planner. El bloque 2 va por la mitad: E5 y E6 están medidos arriba.

Los bloques siguientes — el resto de índices (E7–E8), paginación keyset (E17) y
SQL analítico con joins (E19–E21) — ya tienen sus scripts escritos en
[`docs/perf/scripts/`](docs/perf/scripts/), pero **no se publican acá hasta tener
número medido**. Es la misma regla que gobierna todo lo de arriba: ejercicio sin
evidencia cruda no cuenta, y una sección vacía no es un adelanto, es una promesa.

Las anomalías de concurrencia (el bloque 3 del plan original) no se repiten acá:
ya viven en [`docs/concurrency-model.md`](docs/concurrency-model.md) y en
[`docs/history/closed-race-conditions.md`](docs/history/closed-race-conditions.md),
con su red de regresión en `test/integration/concurrency/`.
