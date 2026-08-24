# Lab de performance PostgreSQL

Cómo levantar el laboratorio de medición en una máquina nueva, y qué convenciones
gobiernan los artefactos que produce.

> Este archivo es el **runbook del lab**, escrito para operarlo. Las conclusiones
> publicables viven en [`PERFORMANCE.md`](../../PERFORMANCE.md); acá está cómo se
> producen.

## Estado de los ejercicios

Los `.sql` de todos los ejercicios están escritos. Lo que distingue a uno cerrado
es que tenga su `.txt` de evidencia en `salida/` **y** su sección en
`PERFORMANCE.md`.

| Bloque | Ejercicios | Estado |
| --- | --- | --- |
| 1 · Leer un plan | E1 · E2 · E3a/b · E4 | **cerrado** — evidencia + narrativa (`PERFORMANCE.md` §1) |
| 2 · Índices | E5 · E6 · E7a/b · E8 | **cerrado** — evidencia + narrativa (`PERFORMANCE.md` §2) |
| 3 · Concurrencia | — | **no aplica**: ya cubierto por `docs/concurrency-model.md` y la suite de `test/integration/concurrency/` |
| 4 · Keyset | E17a/b/c | **cerrado** — evidencia + narrativa (`PERFORMANCE.md` §4) |
| 5 · Analítico y joins | E19 · E20 · E21 | script escrito, sin correr |
| 6 · MVCC y bloat | E13 · E14 · E15 · E16 | script escrito, sin correr |

**La regla que gobierna todo:** ejercicio sin número medido no cuenta. Cada bloque
cierra con algo escrito en `PERFORMANCE.md` o un commit.

---

## Artefactos

| Ruta | Qué es | ¿Se commitea? |
| --- | --- | --- |
| **`docs/perf/GUIA.md`** | **Qué corrés, en qué orden, y qué mirar en cada salida. Empezá acá.** | sí |
| `docs/perf/scripts/*.sql` | El experimento. Reproducible por cualquiera. | sí |
| `docs/perf/scripts/*.md` | Runbooks de los ejercicios que necesitan dos sesiones y no se pueden scriptear | sí |
| `docs/perf/salida/*.txt` | La salida cruda de psql. **Es la evidencia.** | sí |
| `PERFORMANCE.md` | La narrativa con las conclusiones. **Solo se publica ahí lo que tiene número medido** | sí |

Este README es la **puesta en marcha** (infraestructura, datos, convenciones).
Para correr los ejercicios andá a [GUIA.md](GUIA.md).

Los `.txt` se commitean a propósito: un `EXPLAIN` sin su salida cruda es una
afirmación sin respaldo. La cabecera que `pgq` agrega (fecha + archivo fuente) es
lo único que después permite saber sobre qué dataset se midió cada uno.

---

## Puesta en marcha

### 1. Infraestructura

```powershell
docker compose up -d postgres
```

Postgres queda en **5433** (no 5432). El `.env` ya debe tener `DB_PORT=5433`.

El servicio monta `./docker/psqlrc` en `/root/.psqlrc` dentro del contenedor. Al
estar versionado y montado, sobrevive tanto al `docker compose restart postgres`
que pide **E3** como a recrear el contenedor entero. psql lo lee también en modo
no-interactivo (`-f`), así que aplica igual cuando `pgq` captura evidencia.

El archivo **no lleva comentarios**: `pgq` corre psql con `-a` (`--echo-all`), que
imprime *toda* línea no vacía de entrada — incluido el `psqlrc` — al principio de
cada `.txt`. Cuatro directivas, y el porqué de cada una vive acá:

| Directiva | Por qué |
| --- | --- |
| `\timing on` | El `Time: N ms` al pie de cada sentencia. **No es** el número que se reporta en `PERFORMANCE.md` — ese sale del `Execution Time` de adentro del `EXPLAIN ANALYZE`. El de `\timing` incluye ida y vuelta de red y parseo del cliente |
| `\pset pager off` | Con `less` de por medio la salida capturada queda con códigos de escape ANSI, o directamente se cuelga esperando una tecla |
| `\set ON_ERROR_STOP on` | Un error a mitad de archivo aborta. Sin esto un `.sql` con un typo sigue corriendo y produce un `.txt` que parece válido pero midió otra cosa |
| `\pset null '(null)'` | Distinguir "no hay fila" de "hay fila con valor vacío" importa al leer `pg_stats` y `pg_stat_user_tables` |

### 2. `track_io_timing` (una sola vez por volumen)

```powershell
docker compose exec -T postgres psql -U finance_user -d personal_finance_db -c "ALTER SYSTEM SET track_io_timing = on;" -c "SELECT pg_reload_conf();"
```

`ALTER SYSTEM` escribe `postgresql.auto.conf` **dentro del volumen de datos**, así
que persiste a través de restarts y recreaciones del contenedor. Solo hay que
repetirlo si borrás el volumen `postgres_data`.

Sin esto, **E3 no tiene ejercicio**: no se puede separar el tiempo de I/O del de CPU.
Verificalo en una sesión *nueva* — un `SHOW` en la misma sesión donde corriste el
`ALTER SYSTEM` todavía puede devolver el valor viejo.

### 3. Datos

```powershell
node scripts/populate.mjs --reset
```

> ⚠️ **Usá `node` directo, no `npm run populate -- --reset`.** En PowerShell npm no
> forwardea el `--reset` al script; corre sin resetear y muere con un
> `unique constraint` sobre los usuarios ya sembrados. Verificado.

`--reset` es acotado: borra solo los usuarios `seed-load-user-%@finanzas.dev`. Tu
`demo-recruiter@finanzas.dev` de `seed:demo` no se toca.

Los **defaults del script** (15.000 tx · 50 usuarios · 12 meses) **no sirven para
este lab** — ver "Por qué 1.000.000 y no 15.000" abajo. El dataset del lab es:

```powershell
$env:SEED_USERS=200; $env:SEED_TX_COUNT=1000000; $env:SEED_MONTHS=24
node --max-old-space-size=6144 scripts/populate.mjs --reset
```

~2 minutos (medido: 117 s, ~8.500 filas/s). El `--max-old-space-size` es por el
pico de memoria: el script construye el millón de filas en memoria antes del
insert. El script corre `ANALYZE` solo al terminar.

### Por qué 1.000.000 y no 15.000

Con 15.000 filas la tabla ocupaba **259 páginas (2 MB)**. El problema **no** era
que el planner eligiera Seq Scan — medido sobre una reproducción fiel de esa
tabla (15.000 filas muestreadas al azar, reinsertadas en orden de fecha, mismos
índices, `ANALYZE`), elegía **Bitmap Heap Scan en todo el rango**:

| Filtro | Filas | Nodo elegido | Costo | Seq Scan forzado |
| --- | --- | --- | --- | --- |
| ballena (21% de la tabla) | 3.149 | Bitmap Heap Scan | **400,32** | 489,44 |
| cola (0,09%) | 13 | Bitmap Heap Scan | **47,84** | — |
| `nature='expense'` (94,5%) | 14.181 | Seq Scan | 479,95 | — |

El problema real era **que era siempre el mismo nodo**. Del 21% al 0,09% —tres
órdenes de magnitud de selectividad— el plan no cambia. Con solo 257 páginas de
heap, un Index Scan puro nunca llega a ganar (necesitaría un conjunto de filas
tan chico que los fetches aleatorios le ganen a leer 257 páginas enteras), así
que la escalera se aplana a un único escalón y **E2 no tiene cambio de plan que
anotar**. A 1.000.000 de filas sí aparecen los tres nodos (ver la tabla más
abajo).

Vale la pena entender por qué el Bitmap gana ahí, porque es el mismo mecanismo a
1M: **no gana por I/O, gana por CPU**. Con el 21% de las filas repartidas a ~58
filas por página, la probabilidad de que una página no tenga ninguna coincidencia
es (1−0,21)⁵⁸ ≈ 10⁻⁶ — o sea que el bitmap **igual visita las 257 páginas**, las
mismas que el Seq Scan, y Postgres lo sabe (`cost_bitmap_heap_scan` interpola el
costo por página entre `random_page_cost` y `seq_page_cost` a medida que la
fracción de páginas leídas tiende a 1). La diferencia está en el resto de la
fórmula:

```text
Seq Scan   482,00 = 257 páginas·1,0 + 15.000·0,01 (cpu_tuple) + 15.000·0,0025·2 (quals)
Bitmap     392,88 =  ~257 páginas   +  3.149·0,01            + índice 87,90
```

El bitmap evalúa el predicado sobre las 3.149 filas que el índice ya identificó,
no sobre las 15.000. Lo que un bitmap compra **no** es visitar menos páginas —
eso lo fija la distribución de los datos, no el plan— sino visitar cada página
una sola vez, en orden físico, y no gastar CPU en las filas que no coinciden.

Con eso aclarado, lo que el dataset de 15.000 filas sí dejaba sin ejercicio:

- **E2** — "filtrar ~4k y luego ~15k filas": sobre 15.000 filas totales eso es el
  26% y el 100% de la tabla — no son dos selectividades distintas, son "casi
  toda la tabla" dos veces. Y como se vio arriba, todo el rango caía en el mismo
  nodo igual. Sobre 1.000.000 son el 0,4% y el 1,5%, y el nodo sí cambia.
- **E3** — `shared hit=` vs `read=`: la base entera (18 MB) entraba 7 veces en
  `shared_buffers` (128 MB). Después del primer toque todo era `hit` para
  siempre. Ahora el heap solo ya son **133 MB > 128 MB**, así que `read=` existe.
- **E17** — `OFFSET 10000` necesita un usuario con >10.000 filas. El más grande
  tenía 3.915.

**Los tres nodos verificados sobre el dataset actual** (solo `EXPLAIN` de costos,
sin `ANALYZE` ni `BUFFERS` — E1/E2/E3 siguen sin gastar). El costo es el total del
plan y las filas son la estimación del nodo de scan:

| Filtro | Filas est. | Nodo elegido | Costo |
| --- | --- | --- | --- |
| `user_id` = cola (`user-120`) + `category` + `nature` + 1 mes | 1 | **Index Scan** | 8,59 |
| `user_id` = cola + `nature='expense'` | 844 | **Bitmap Heap Scan** | 2.829 |
| `user_id` = ballena (`user-1`) + `nature='expense'` | 200.013 | **Bitmap Heap Scan** | 29.855 |
| `nature='expense'` solo | 942.867 | **Seq Scan** | 31.941 |

Los tres nodos que E2 tiene que ver existen, y el mismo query cambia de nodo
**solo cambiando el `user_id`** — que es exactamente la lección: el planner no
mira el volumen absoluto, mira la fracción. Notar además que la ballena y la cola
ni siquiera usan el mismo índice (`idx_tx_user_date` contra
`idx_tx_user_cat_nature_date`).

La ballena queda además **cerca del borde** del Seq Scan: 29.855 contra los
31.941 que cuesta el Seq Scan de la última fila. No son el mismo query, así que
no es una comparación directa — pero dice que ensanchar el filtro de la ballena
cruza el umbral, y encontrar dónde lo cruza es el ejercicio.

### 4. Gate

```powershell
. .\scripts\pgq.ps1
pgq docs\perf\scripts\setup.sql
```

---

## Las dos terminales

El lab se trabaja con **dos terminales PowerShell** (no Git Bash — `pgq.ps1` no corre ahí).
Están definidas como perfiles de VSCode en [`.vscode/settings.json`](../../.vscode/settings.json),
así que ya arrancan cargadas:

1. Panel de terminal → flecha del botón **`+`** → elegir el perfil
   (o `Ctrl+Shift+P` → *Terminal: Create New Terminal (With Profile)*)

| Perfil | Arranca en | Para qué |
| --- | --- | --- |
| **Lab A - explorar (pg)** | el prompt de psql | tantear queries, iterar. Nada queda guardado |
| **Lab B - capturar (pgq)** | PowerShell con `pgq` cargado | correr los `.sql` y guardar la evidencia |

Por qué separadas: `pg` te deja *dentro* de psql y se apodera de la terminal. Mientras
estés en ese prompt no podés correr `pgq`. Tenerlas separadas evita entrar y salir
treinta veces.

En A salís de psql con `\q` y quedás en PowerShell con las funciones ya cargadas
(`pg` te devuelve al prompt).

**Sin VSCode**, o en una terminal cualquiera, cargalas a mano con dot-source
(**el punto y el espacio importan** — sin el punto las funciones no quedan definidas):

```powershell
. .\scripts\pgq.ps1
```

| Comando | Para qué | ¿Guarda? |
| --- | --- | --- |
| `pg` | psql interactivo. Explorar, tantear queries, iterar. | no |
| `pgq <archivo.sql>` | Correr un experimento y capturar la evidencia en `docs/perf/salida/<nombre>.txt` | sí |

`pgq` usa `psql -a` (echo-all): deja **cada sentencia escrita junto a su
resultado**. Un `.txt` con solo resultados es inútil en tres semanas.

> ⚠️ **No uses pgAdmin ni DBeaver para los ejercicios.** Trabajan en autocommit y
> pueden reconectar en silencio: tu "sesión A" del Bloque 3 podría no ser el mismo
> backend y el resultado sería silenciosamente equivocado.

**Bloque 3 necesita dos terminales con `pg` simultáneas.** Verificá que son backends
distintos y estables antes de empezar:

```sql
SELECT pg_backend_pid();
```

---

## Convenciones

**Al inicio de todo `.sql` de medición:**

```sql
SET max_parallel_workers_per_gather = 0;
```

Un `Gather` reparte el trabajo entre workers y los buffers reportados dejan de ser
comparables entre corridas (dependen de cuántos workers consiguió esa vez). Se apaga
para *leer planes*, no porque esté mal en producción.

**Para planes complejos:** `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` → pegar en
[explain.dalibo.com](https://explain.dalibo.com) → link compartible desde `PERFORMANCE.md`.

**Comandos psql útiles:** `\d transactions` · `\di` · `\gset` · `\echo :var` · `\x auto` · `\q`

**El `Time: N ms` que imprime `\timing` NO es el número que se reporta.** Incluye red
y parseo del cliente. El número que va a `PERFORMANCE.md` es el `Execution Time` de
adentro del `EXPLAIN ANALYZE`.

---

## Cuándo re-correr el Gate

`setup.sql` es idempotente. Volvé a correrlo:

- **Después de E4** — ese ejercicio deja el catálogo mintiendo *a propósito* (el
  `ROLLBACK` revierte las filas pero **no** las estadísticas). Si seguís sin limpiar,
  el bloque siguiente arranca sobre stats falsas.
- **Después de cualquier re-seed** (ver la advertencia de E17a abajo).
- **Cuando un plan te sorprenda** y no sepas si el problema es el query o las stats.

---

## Orden de ejecución y dependencias duras

```text
Gate → Bloque 1 → Bloque 2 → Bloque 4 → Bloque 5 → Bloque 3 → Bloque 6
```

- Gate antes que todo
- **E1 antes que E5** — necesitás el "antes"
- **E6 antes que E7** — `Heap Fetches` solo existe dentro de un Index Only Scan
- **E17b antes que E17c** — sin orden indexado el keyset no rinde
- **E19 antes que E20** — el join a analizar sale del reporte

---

## Advertencias específicas de este repo

Cosas que la lista de ejercicios no podía saber y que se detectaron al montar el lab.

### E5 choca con una decisión ya tomada

[`docs/period-sum-index-decision.md`](../period-sum-index-decision.md) (aprobada
2026-07-02) concluye explícitamente **no agregar el índice parcial**, con dos
razones: solo rinde a millones de filas, y TypeORM 0.3 no lo modela
declarativamente (deriva entity↔DB si se agrega a mano).

Además `idx_tx_user_cat_nature_date` **ya cubre** la query de E1. Consecuencia: el
"antes" del Bloque 2 **no va a ser un Seq Scan**, y E5 deja de demostrar "índice vs.
sin índice" para demostrar "índice general vs. índice especializado".

**E5 está cerrado** (evidencia en `salida/e5-partial-index.txt`, narrativa en
`PERFORMANCE.md` §2), y se corrió como experimento efímero: crear → medir → `DROP`,
sin migration commiteada. La decisión de `period-sum-index-decision.md` sigue en pie
— no hay ninguna migration con `idx_tx_expense_period`. Si alguna vez se decide
crear la migration, hay que actualizar ese doc y `docs/conventions.md` en el mismo
PR.

> **Verificá los índices antes de medir el Bloque 2.** El `DROP` del final de
> `e5-partial-index.sql` puede no haber corrido — si el script aborta antes
> (`ON_ERROR_STOP`), el índice queda vivo. Una base con un índice de más no está
> midiendo el esquema real: cambia el tamaño total de índices (E8) y la
> amplificación de escritura. Contra lo que definen las migraciones deben existir
> exactamente **tres**: `idx_tx_user_cat_nature_date`, `idx_tx_user_date`,
> `idx_tx_account_date` (más la PK).
>
> ```sql
> SELECT indexname FROM pg_indexes WHERE tablename = 'transactions' ORDER BY 1;
> DROP INDEX IF EXISTS idx_tx_expense_period;  -- si aparece de más
> ```

Nota adicional del dataset: con **94,60% de filas `expense`**, un índice parcial
`WHERE nature = 'expense'` excluye apenas el 5,40%. No maquillar ese número — y
notar que con el dataset de 1.000.000 el margen se estrechó todavía más que con
el de 15.000 (era 8,57%). Así terminó siendo: la conclusión de E5 no fue "el índice
parcial pesa menos" sino "acá el valor del índice parcial es la especialización, no
el tamaño" (conclusión 3 de E5 en `PERFORMANCE.md`). Es un gasto realista en
finanzas personales: la gente registra muchos más gastos que ingresos.

### ADR-0006 ya está ocupado

La lista pide "ADR-0006 keyset pagination", pero
[`docs/adr/0006-domain-exceptions-vs-http.md`](../adr/0006-domain-exceptions-vs-http.md)
ya existe. Ocupados: 0000–0009. **El keyset es ADR-0010.**

### E17a exigía re-seed — resuelto por adelantado

E17a necesita un usuario con >10.000 transacciones, y sobre el dataset viejo de
15.000 filas el más grande tenía 3.915. Re-seedear a mitad del lab cambia el
dataset bajo los pies de los Bloques 1 y 2 y **los números dejan de ser
comparables entre sí**.

Por eso el re-seed **ya se hizo, antes del Bloque 1**: el dataset de 1.000.000 de
filas es el único sobre el que se mide todo. `seed-load-user-1` tiene 212.817
transacciones, de sobra para E17a. **No re-seedees a mitad del lab.** Si por algo
tenés que hacerlo, re-corré el Gate y anotá en `PERFORMANCE.md` a partir de qué
tabla cambió el dataset — la cabecera con fecha que `pgq` escribe en cada `.txt`
es el respaldo.

### E7 arranca sin ejercicio: el autovacuum ya marcó el visibility map

Después del seed, `relallvisible` era 0. Pero el insert de 1.000.000 de filas
dispara el **autovacuum por inserción** (`autovacuum_vacuum_insert_threshold`,
default 1000, PG13+), que corrió 3 veces y dejó el visibility map **al 100%**
(17.084 de 17.084 páginas):

```sql
SELECT relpages, relallvisible FROM pg_class WHERE relname = 'transactions';
```

Consecuencia directa: si llegás a E7 y hacés el Index Only Scan sin más, vas a
leer `Heap Fetches: 0` de entrada y **no hay nada que arreglar con `VACUUM`**. El
ejercicio necesita ensuciar la tabla primero (un `UPDATE` limpia el bit del VM de
las páginas que toca, que es exactamente lo que E7 quiere observar).

Esto no es un defecto del entorno: *es* el mecanismo que E7 estudia, visto desde
el otro lado. Pero conviene saberlo antes, y conviene decidir si querés que el
autovacuum siga interviniendo mientras medís — puede volver a marcar el VM entre
tu `UPDATE` y tu `EXPLAIN`, y ahí el resultado cambia sin que hayas hecho nada:

```sql
-- Solo si querés controlar vos cuándo se vacía (Bloques 2 y 4). Reversible.
ALTER TABLE transactions SET (autovacuum_enabled = false);
-- Para devolverlo al comportamiento de producción:
ALTER TABLE transactions RESET (autovacuum_enabled);
```

Se deja **encendido** a propósito: apagarlo esconde justamente al actor que E7,
E15 y E16 estudian. La decisión es tuya, pero tomala a sabiendas.

### El Bloque 3 ya tiene artefacto

El repo ya documenta el catálogo de carreras cerradas:

- [`docs/concurrency-model.md`](../concurrency-model.md)
- [`docs/adr/0002-unit-of-work-pessimistic-locks.md`](../adr/0002-unit-of-work-pessimistic-locks.md)
- [`docs/history/closed-race-conditions.md`](../history/closed-race-conditions.md)
- red de regresión: `test/integration/concurrency/concurrency.integration.spec.ts`

Aplica la rebaja que la propia lista contempla (~1h en vez de 2h 30m): el objetivo
deja de ser *demostrar* que el lock funciona y pasa a ser la experiencia sensorial de
reproducirlo a mano, para poder explicarlo en inglés sin notas.

---

## Línea base del Gate (2026-08-10, 1.000.000 filas)

Evidencia completa: [`salida/setup.txt`](salida/setup.txt). Reemplaza la línea base
del 2026-08-07 sobre 15.000 filas: ese dataset era demasiado chico para que el
planner tuviera algo que decidir (ver "Por qué 1.000.000 y no 15.000" arriba).

| Chequeo | Criterio | Resultado |
| --- | --- | --- |
| `count(*)` | 1.000.000 | **1.000.000** ✅ |
| `reltuples` | cercano al real, nunca −1 ni 0 | **1.000.000** (exacto) ✅ |
| Curva por usuario | decreciente | **21,282% → 0,063%**, ratio 340x ✅ |
| `correlation` `transaction_date` | cercano a 1 | **1.0000** ✅ |
| `correlation` `user_id` | cercano a 0 | **0,0703** ✅ |
| Reparto `nature` | expense dominante | **94,60% expense / 5,40% income** ✅ |
| Heap vs `shared_buffers` | heap > 128 MB | **133 MB** ✅ |
| `track_io_timing` | `on` | **on** ✅ |
| `v_period_expenses` | existe | **existe** ✅ |

Tamaños: heap **133 MB** (17.084 páginas) · índices **288 MB** · total **421 MB**.
Rango temporal: **2024-09 → 2026-08**, 24 meses completos.

**Camino A de E2 habilitado.** Los dos parámetros de E1/E2:

| Rol | Email | `user_id` | tx | % tabla |
| --- | --- | --- | --- | --- |
| ballena | `seed-load-user-1` | `7afba7e7-5856-4bd5-8cce-57887f4b1947` | 212.817 | 21,282% |
| cola | `seed-load-user-200` | `1141235c-9ea5-479c-bb45-de7c18e822f1` | 626 | 0,063% |

**Corrección al dato de E8 de la línea base anterior.** Decía que los índices pesaban
8x el heap (16 MB contra 2 MB). Eso **no era la proporción real**: era bloat de
índice acumulado por correr `--reset` muchas veces (el `DELETE`+`INSERT` deja
páginas de índice que ningún `VACUUM` normal devuelve). Con las tablas compactadas
antes de sembrar, la proporción real es **288 MB de índice contra 133 MB de heap —
2,2x**. Sigue siendo el argumento de E8, pero el número honesto es 2,2x, no 8x.
`idx_tx_user_cat_nature_date` solo son **113 MB**, más que el heap entero.

**Ojo con el mes corriente.** El seed nunca genera fechas futuras, así que las
55.521 filas de `2026-08` están comprimidas en los **días 1 al 10**: ~5.550
filas/día contra ~1.750 de un mes normal, **3,2x más denso**. Un rango de fechas
sobre el mes corriente no mide lo mismo que sobre cualquier otro. **Medí siempre
sobre `2026-07`** (54.347 filas, mes cerrado).
