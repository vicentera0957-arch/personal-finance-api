# Ejercicios PostgreSQL — lista consolidada

- **Última actualización:** 2026-08-30

**Alcance:** solo base de datos. Cantrill, ERP, inglés y visibilidad quedan fuera.

**Regla que gobierna todo:** ejercicio sin número medido no cuenta. Cada bloque cierra
con algo escrito en `performance.md` / `CONCURRENCY.md` o un commit.

**Convención de artefactos:**

- `docs/perf/scripts/*.sql` — el experimento (se commitea)
- `docs/perf/salida/*.txt` — la salida cruda (se commitea)
- `performance.md` — la narrativa con conclusiones

**Total estimado:** ~13h 45m del núcleo obligatorio · ~4h 45m de extensiones opcionales.

> **Estado al 2026-08-12:** Gate ✅ · E1 ✅ · E2 ✅ · E3 ✅ · E4 ✅ · E5 ✅ — Bloque 1
> cerrado, Bloque 2 en curso. Las notas marcadas **[verificado]** corrigen supuestos del
> plan original que se comprobaron falsos contra el repo o contra el dataset.

---

# 🔒 Gate — 20 min ✅

> Sin volumen y sin estadísticas frescas, **todo lo demás miente**. El planner elige por
> costo estimado, y el costo estimado sale de `pg_statistic`.

📖 [Data Volume — Sloppy indexing bites back](https://use-the-index-luke.com/sql/testing-scalability/data-volume)

### G.1 — Seed con distribución realista · 10 min

```bash
SEED_USERS=200 SEED_TX_COUNT=1000000 SEED_MONTHS=24 node --max-old-space-size=6144 scripts/populate.mjs --reset
```

> **[verificado]** El plan original decía `npm run populate -- --reset`. En PowerShell ese
> `--reset` no se reenvía al script, y los defaults dan 15.000 filas — insuficiente para
> E2, E3 y E17. Usar la invocación de arriba.

**Prerequisito:** el script debe tener aplicada la distribución Pareto. Si sigue siendo
uniforme, E2 no muestra nada por el camino A — usar el camino B.

### G.2 — Estadísticas · 2 min

```sql
ANALYZE transactions; ANALYZE accounts; ANALYZE budgets; ANALYZE categories;
```

### G.3 — Verificación · 8 min

`docs/perf/scripts/setup.sql` — conteo real, `reltuples`, distribución por usuario, reparto
`nature`, `pg_stats` (`n_distinct`, `correlation`), índices existentes.

**Criterios de aprobación:**

| Chequeo | Debe dar | Real |
| --- | --- | --- |
| `count(*)` | 1.000.000 | ✅ 1.000.000 |
| `reltuples` | cercano al real, nunca `-1` ni `0` | ✅ |
| top 5 usuarios | curva decreciente | ✅ 21,3% → 0,063% |
| `correlation` de `transaction_date` | cercano a 1 | ✅ 1,0000 |
| índices | anotar cuáles hay **ya** | ✅ 3 + PK |

---

# Bloque 1 · Línea base medible — 2h 15m ✅

*Produce: `performance.md` §1 "Antes".*

### E1 — Baseline crudo · 30 min ✅

📖 [Getting an Execution Plan](https://use-the-index-luke.com/sql/explain-plan/postgresql/getting-an-execution-plan)

`EXPLAIN (ANALYZE, BUFFERS)` sobre el equivalente SQL de
`sumExpenseAmountByUserCategoryAndPeriod` — la query que protege el invariante del
presupuesto. Pegar la salida **tal cual**, sin interpretar.

Anotar: nodo elegido · `cost=startup..total` · `rows=` vs `actual rows=` ·
`shared hit/read` · planning y execution time.

**Demuestra:** nada todavía. Es la foto del "antes". La disciplina es no interpretar.

> **Resultado:** Bitmap Heap Scan vía `idx_tx_user_cat_nature_date`, 982 buffers
> (63 índice + 919 heap), ~2,9 ms caliente. `rows=852` contra `actual rows=4028`.

---

### E2 — La selectividad decide, no el volumen · 40 min ✅

📖 [Data Volume](https://use-the-index-luke.com/sql/testing-scalability/data-volume) ·
[Operations](https://use-the-index-luke.com/sql/explain-plan/postgresql/operations)

**Camino A (con seed Pareto):** mismo query sobre el usuario más grande y el más chico.
**Camino B:** cuatro fracciones — `nature='expense'` · `nature='income'` · un usuario ·
un usuario + un mes.

Tabla: filas devueltas · fracción · nodo elegido · buffers · execution time.

**Demuestra:** el planner minimiza costo estimado, y ese costo depende de la *fracción*
de la tabla que devuelve el filtro, no de un número absoluto de filas.

> **Resultado:** el título del ejercicio quedó desarmado. La fracción no decide sola:
> `income` es el 5,4% de las filas y toca el 96,2% de las páginas. Lo que decide es la
> **selectividad de páginas**, no la de filas.

---

### E3 — Leer buffers, no milisegundos · 30 min ✅

📖 [System Load](https://use-the-index-luke.com/sql/testing-scalability/system-load)

Medición en frío (`docker compose restart postgres`, luego primera ejecución) contra
dos ejecuciones en caliente seguidas.

Tabla: `shared hit=` · `shared read=` · `I/O Timings` · execution time.

**Demuestra:** el I/O es la unidad real de costo. El número de buffers tocados es
idéntico en las tres corridas; lo que cambia es de dónde vinieron.

⚠️ Requiere `track_io_timing = on`.

> **Resultado:** 982 buffers en las tres corridas, 29× de spread en tiempo. Y el hallazgo:
> `shared read` no es disco — hay una segunda capa (page cache del kernel) 40× más rápida.

---

### E4 — Estimado vs. real · 35 min ✅

Dentro de `BEGIN` / `ROLLBACK`: medir → insertar 5k filas **sin** `ANALYZE` → medir →
`ANALYZE` → medir.

⚠️ El `ROLLBACK` revierte las filas pero **no** las estadísticas. Correr `ANALYZE`
final o el bloque siguiente arranca con un catálogo mentiroso.

Tabla: `reltuples` · `rows=` estimado · `actual rows=` · ratio · nodo.

**Demuestra:** de dónde salen las malas decisiones del planner en producción. Es el
diagnóstico raíz #1, y **no se arregla con índices** sino con estadísticas.

> **Resultado:** ni con estadísticas. El error de 4,7× viene de **independencia asumida
> entre columnas** y se arregla con `CREATE STATISTICS` (853 → 4.161 sobre 4.028 reales).
> Confirmado además que `ROLLBACK` no revierte `pg_class.reltuples` pero sí `pg_statistic`.

---

📄 **Entregable:** `performance.md` §1 completa. ✅
✅ **Checkpoint (inglés):** *"Why did the planner switch plans between 4k and 15k rows?"*

---

# Bloque 2 · Índices que cambian el plan — 2h 30m 🔄

*Produce: `performance.md` §2 "Antes/Después" + commit de migration.*

### E5 — Partial index · 45 min ✅

📖 [Partial Indexes](https://use-the-index-luke.com/sql/where-clause/partial-and-filtered-indexes) ·
[Greater, Less and BETWEEN](https://use-the-index-luke.com/sql/where-clause/searching-for-ranges/greater-less-between-tuning-sql-access-filter-predicates)

```sql
CREATE INDEX CONCURRENTLY idx_tx_expense_period
  ON transactions (user_id, category_id, transaction_date)
  WHERE nature = 'expense';
```

Re-medir E1. Anotar el nuevo nodo, buffers y tiempos.

**Demuestra:** por qué `CONCURRENTLY` es obligatorio en producción (no toma
`ACCESS EXCLUSIVE`), y por qué un índice parcial pesa menos y cachea mejor.

⚠️ **Leer la página de rangos junto con esta.** El índice pone `transaction_date` al
final: eso está *bien* y es deliberado — la columna de rango va última, las de igualdad
primero. Es la regla que más se equivoca en producción.

⚠️ **Nota honesta sobre el dataset:** con **94,6%** de filas `expense`, el índice parcial
excluye apenas un **5,4%** — no el 8% que decía el plan original **[verificado]**. El
valor del índice parcial no es el tamaño sino la especialización al patrón de query.

⚠️ `CREATE INDEX CONCURRENTLY` no corre dentro de una transacción.

> **Resultado:** el índice parcial ahorró **5 buffers de 982 (0,5%)**. El hallazgo real
> fue otro: el índice del schema está **43% inflado** porque `InitialSchema` lo crea antes
> de que existan los datos. El bloat costaba 102 buffers. Un `REINDEX` habría dado 20×
> más ganancia que el índice nuevo.

---

### E6 — Covering index → Index Only Scan · 35 min ⬜

📖 [Index-Only Scan](https://use-the-index-luke.com/sql/clustering/index-only-scan-covering-index) ·
[INCLUDE columns in B-tree indexes](https://use-the-index-luke.com/blog/2019-04/include-columns-in-btree-indexes)

Agregar `INCLUDE (amount)` y forzar el Index Only Scan.

**Demuestra:** la diferencia entre "encontrar la fila" y "no tener que ir al heap".

**Trade-off a documentar:** `INCLUDE` no es lo mismo que agregar la columna a la clave.
Las columnas incluidas no sirven para buscar ni para ordenar, solo para evitar el heap
— y por eso no engordan los nodos internos del árbol.

---

### E7 — 🔑 `Heap Fetches` · 30 min ⬜

📖 [Index-Only Scan](https://use-the-index-luke.com/sql/clustering/index-only-scan-covering-index)

Mirar `Heap Fetches: N` en el Index Only Scan. Correr `VACUUM transactions;` y volver a
medir hasta llevarlo a 0.

**Demuestra en vivo el visibility map:** los índices no tienen información de
visibilidad, por eso sin VACUUM el "index only" igual toca el heap.

⚠️ **[verificado]** El autovacuum ya dejó el visibility map al 100%, así que el ejercicio
arrancaría con `Heap Fetches: 0` y no habría nada que ver. Hay que **ensuciar primero**:
`e7a` apaga `autovacuum_enabled` en la tabla, hace un UPDATE masivo y mide; `e7b` corre el
VACUUM y **vuelve a prender el autovacuum** (paso obligatorio).

✅ **Checkpoint:** *"What does `Heap Fetches: 0` actually prove?"*

---

### E8 — El costo del índice · 40 min ⬜

📖 [Update](https://use-the-index-luke.com/sql/dml/update) ·
[Insert, Delete, Update](https://use-the-index-luke.com/sql/dml)

`UPDATE` masivo antes y después de tener los índices creados. Medir tiempo y buffers.

**Demuestra:** write amplification. Un índice no es gratis — y en un ledger, donde el
patrón es write-heavy, esa asimetría importa más que en un CRUD.

⚠️ Requiere E5 y E6 corridos: el script hace `DROP INDEX` de los dos.

---

📄 **Entregable:** `performance.md` §2 con planning time, execution time, buffers y
nodo, antes/después · commit de la migration.

---

# Bloque 3 · Concurrencia — 2h 30m ⬜

*Produce: `docs/CONCURRENCY.md` o ADR.*

> ⚠️ **Revisá primero `docs/concurrency-model.md` y ADR-0002.** Si las cuatro anomalías ya
> están documentadas, este bloque baja a ~1h: no necesitás volver a *demostrar* que el lock
> funciona, necesitás la experiencia sensorial de reproducirlo a mano.

> ⚠️ **Requieren dos sesiones psql simultáneas.** No se hacen en DBeaver ni pgAdmin:
> trabajan en autocommit y pueden reconectar en silencio. Verificá con
> `SELECT pg_backend_pid();` en ambas antes de empezar.

> 📄 Runbook: `docs/perf/scripts/bloque3-concurrencia.md`
> Setup y limpieza: `bloque3-setup.sql` · `bloque3-limpieza.sql`

📖 **Sin cobertura en Use The Index, Luke** — el libro es sobre indexación y acceso.
Fuentes: Nasser (*Concurrency Control*) + [PostgreSQL cap. 13](https://www.postgresql.org/docs/15/mvcc.html)

### E9 — Reproducir el lost update · 35 min

Dos sesiones sobre la misma cuenta, sin lock. Ver la plata desaparecer.

**Demuestra:** por qué esto **no** lo salva `READ COMMITTED`.

### E10 — El mismo escenario con `SELECT ... FOR UPDATE` · 35 min

Verificar que la segunda sesión bloquea. **Conectar explícitamente con el pessimistic
lock de tu Unit of Work.**

**Te lleva de** "usé locks" **a** "elegí este lock, y sé qué cuesta en throughput".

### E11 — Provocar un deadlock a propósito · 30 min

Dos sesiones tomando dos filas en orden inverso. Leer el mensaje de Postgres y entender
por qué mata a una.

**Demuestra:** los deadlocks se previenen ordenando los accesos, no con reintentos.

### E12 — Write skew · 50 min

Dos filas que individualmente pasan la validación pero juntas la rompen. Verificar que
`SERIALIZABLE` lo detecta y `REPEATABLE READ` no.

**El concepto más subestimado del bloque.** En tu dominio es exactamente el caso del
presupuesto: dos gastos que por separado caben bajo el límite y juntos lo superan.

---

📄 **Entregable:** `docs/CONCURRENCY.md` o ADR con los 4 escenarios + la justificación
del lock del UoW.
✅ **Checkpoint:** *"Walk me through how two concurrent transfers could double-spend,
and what you did about it."*

---

# Bloque 4 · Keyset pagination — 1h 30m ⬜

> **Reubicado.** *Keyset en producción* es uno de los cuatro requisitos duros de cierre.
> Además no es un fix: **cambia el contrato de la API.**

### E17a — Medir la degradación · 30 min

📖 [Fetching The Next Page](https://use-the-index-luke.com/sql/partial-results/fetch-next-page) ·
[Top-N Queries](https://use-the-index-luke.com/sql/partial-results/top-n-queries)

`OFFSET 0`, `1000`, `10000`, `100000`, `200000` sobre el mismo query. Tabla con buffers y
tiempo por cada uno.

⚠️ Necesita un usuario con más de 10.000 transacciones. **[verificado]** La ballena tiene
212.817 — resuelto por adelantado, no hace falta re-seed.

**Demuestra:** `OFFSET` no es lento por leer 10 filas — es lento porque **igual tiene
que producir y descartar las N anteriores**. Costo O(offset), no O(1).

### E17b — Índice que entrega el orden · 20 min

📖 [Indexed Order By](https://use-the-index-luke.com/sql/sorting-grouping/indexed-order-by) ·
[ORDER BY ASC/DESC and NULLS LAST](https://use-the-index-luke.com/sql/sorting-grouping/order-by-asc-desc-nulls-last)

**Prerequisito conceptual del keyset.** Sin un índice que entregue las filas ya
ordenadas, el `LIMIT` no puede abortar nada: el `Sort` es una operación **materializada**
y tiene que consumir toda su entrada antes de emitir la primera fila.

Verificar que desaparece el nodo `Sort` del plan.

### E17c — Implementar keyset + ADR · 40 min

```sql
WHERE (transaction_date, id) < ($1, $2) ORDER BY transaction_date DESC, id DESC LIMIT n
```

**Escribir ADR-0010** — **[verificado]**, no 0006: `docs/adr/` ya va del 0000 al 0009.
Trade-off explícito: se pierde el salto a página arbitraria, se gana costo constante por
página. Documentar el cambio de contrato (`page` sale, entra un cursor opaco).

> 🎯 **Bonus encontrado:** `ORDER BY transactionDate DESC` no tiene desempate por `id`, y
> hay ~32.000 timestamps duplicados en 1M de filas. La paginación actual **puede saltear o
> repetir filas hoy**. Es un bug de correctitud, no de performance — y es el hallazgo más
> fuerte del lab para mostrar.

---

📄 **Entregable:** endpoint migrado · **ADR-0010** · `performance.md` §4.

---

# Bloque 5 · SQL analítico + joins — 2h 30m ⬜

> Es el único bloque que produce una **feature**, no solo documentación.

### E19 — Reporte mensual con CTEs + window functions · 60 min

📖 [Window Functions](https://use-the-index-luke.com/sql/partial-results/window-functions)

Un solo query con CTEs encadenados que produzca, por usuario y mes: gasto por categoría ·
`SUM() OVER` para el balance corrido · `LAG()` contra el mes anterior · `ROW_NUMBER()`
para el top-N.

**Demuestra:** que la agregación compleja vive en la base, no en el código de
aplicación. Es el argumento de "no traigas 200.000 filas a Node para sumarlas".

⚠️ **[verificado]** El plan asumía que el endpoint de reportes no existía.
`GET /reports/summary` ya existe. E19 lo **extiende**, no lo crea.

### E20 — Estrategia de joins · 50 min

📖 [Nested Loops](https://use-the-index-luke.com/sql/join/nested-loops-join-n1-problem) ·
[Hash Join](https://use-the-index-luke.com/sql/join/hash-join-partial-objects) ·
[Sort-Merge Join](https://use-the-index-luke.com/sql/join/sort-merge-join)

`EXPLAIN` sobre el reporte de E19, que cruza `transactions` × `categories` × `budgets`.
Identificar qué algoritmo eligió cada join y por qué. Forzar los tres para comparar:

```sql
SET enable_hashjoin = off;
SET enable_mergejoin = off;
SET enable_nestloop = off;
RESET ALL;
```

**Demuestra:** cada algoritmo pide una estrategia de indexado **distinta**. Nested Loop
quiere un índice en el lado interno; Hash Join no usa índices para unir, así que indexás
lo que *filtra*, no lo que une. Es el error conceptual más común al "optimizar joins".

⚠️ Los `enable_*` son para aprender, no para producción. Documentalo.

### E21 — El N+1 de TypeORM · 40 min

📖 [Nested Loops / N+1 problem](https://use-the-index-luke.com/sql/join/nested-loops-join-n1-problem)

Activar `DB_LOGGING=true`. Llamar al endpoint de listado de transacciones y contar cuántas
queries se emiten. Comparar la carga lazy contra `relations` / `leftJoinAndSelect`.

⚠️ **[verificado] Este repo NO tiene el N+1.** `findByUserId` llama a `find()` sin
`relations`, y las `@ManyToOne` están tipadas `UserOrmEntity`, no `Promise<T>` — sin eso
TypeORM 0.3 nunca hace lazy loading. **Verificar la ausencia es la mitad del ejercicio;
fabricarlo a propósito es la otra mitad.** Runbook: `docs/perf/scripts/e21-n1-typeorm.md`.

---

📄 **Entregable:** endpoint de reportes + `performance.md` §5 con el conteo de queries
antes/después.

---

# Bloque 6 · MVCC visible — 2h 10m · 🟡 OPCIONAL

> Alto valor conceptual, cero valor de artefacto. Si hay que recortar, este bloque cae
> entero — pero **E15 es el mejor ejercicio de toda la lista** y vale rescatarlo suelto.

### E13 — Ver MVCC físicamente · 25 min

```sql
SELECT ctid, xmin, xmax, * FROM transactions LIMIT 5;
```

`UPDATE` y volver a mirar el `ctid`.

**Demuestra:** que la teoría toque disco — "actualizar" nunca es modificar en el lugar.

### E14 — HOT updates · 35 min

📖 [Update](https://use-the-index-luke.com/sql/dml/update)

`n_tup_upd` vs `n_tup_hot_upd` en `pg_stat_user_tables`. Actualizar una columna **no**
indexada, después una **sí** indexada, comparar el ratio.

**Demuestra:** por qué no se indexan columnas volátiles. Conecta directo con E8.

### E15 — 👑 El xmin horizon · 45 min

Sesión A: `BEGIN;` + `SELECT`, **dejarla abierta**. Sesión B: borrar 10k filas,
`VACUUM`, comprobar que el espacio **no** se libera. Cerrar A, re-vacuum, comprobar que
ahora sí.

**El incidente #1 real de Postgres en producción**, reproducido con tus manos. Una
transacción abierta y olvidada impide limpiar tuplas muertas de **toda** la base, no solo
de las tablas que tocó.

Requiere dos sesiones. Runbook: `docs/perf/scripts/e15-xmin-horizon.md`.
Si recortás el bloque, hacé este igual.

### E16 — Bloat · 25 min

📖 [Myth: Indexes can degenerate](https://use-the-index-luke.com/sql/myth-directory/indexes-can-degenerate)

`pg_relation_size` antes y después de un `VACUUM` normal: verificar que **no baja**.
Contrastar con `REINDEX CONCURRENTLY`.

**Demuestra:** dead tuples y bloat son problemas distintos. Y de paso desarma el mito de
que los índices "se degeneran".

> 🎯 **[verificado] Ya tenés el número:** el índice del schema pesa 114 MB y reconstruido
> pesa 65 MB — **43% de bloat**, medido en E5 con un índice de control. E16 lo confirma
> con `REINDEX`. Este ejercicio subió de prioridad: es el hallazgo más accionable del
> Bloque 2.

---

# ❌ Descartado

### E18 — Connection pooling

**Viola la regla del bloque.** Está definido como "puente conceptual con RDS Proxy" — no
produce número medido ni artefacto. Además no tiene cobertura en Use The Index, Luke.
Si querés el concepto, leelo cuando Cantrill llegue a RDS Proxy.

---

# Resumen de tiempos

| Bloque | Contenido | Tiempo | Estado |
| --- | --- | --- | --- |
| 🔒 Gate | Seed + ANALYZE + verificación | 20 m | ✅ |
| 1 | E1–E4 · línea base | 2h 15m | ✅ |
| 2 | E5–E8 · índices | 2h 30m | 🔄 E5 ✅ |
| 3 | E9–E12 · concurrencia | 2h 30m | ⬜ |
| 4 | E17a–c · keyset + ADR | 1h 30m | ⬜ |
| 5 | E19–E21 · analítico + joins | 2h 30m | ⬜ |
| **Núcleo** | | **11h 35m** | |
| 6 🟡 | E13–E16 · MVCC | 2h 10m | ⬜ |
| **Total** | | **13h 45m** | |

**Si el Bloque 3 ya está cubierto** por `concurrency-model.md` + ADR-0002, restá ~1h 30m.

---

# Orden de ejecución

```text
Gate → Bloque 1 → Bloque 2 → Bloque 4 → Bloque 5 → Bloque 3 → Bloque 6
```

**Por qué este orden y no el del plan original:**

1. **Bloque 4 (keyset) sube.** Es requisito de cierre y arregla un bug real de la API.
   No puede quedar detrás de tres bloques.
2. **Bloque 5 antes que el 3.** Produce una feature. Concurrencia probablemente ya tenga
   artefacto.
3. **Bloque 6 al final.** Es el único totalmente prescindible.

**Dependencias duras:** Gate antes que todo · E1 antes que E5 (necesitás el "antes") ·
E6 antes que E7 (`Heap Fetches` solo existe en un Index Only Scan) · E5 y E6 antes que E8
(les hace `DROP INDEX`) · E17b antes que E17c (sin orden indexado el keyset no rinde) ·
E19 antes que E20 (el join a analizar sale del reporte) · E8/E13/E14 antes que E16 (sin
bloat previo no hay nada que medir).

---

# Definición de "Capa 1 cerrada"

No es haber terminado los ejercicios. Es tener los artefactos:

- [ ] `performance.md` con ≥2 EXPLAIN antes/después con números propios
- [ ] `CONCURRENCY.md` o ADR con las 4 anomalías reproducidas
- [ ] Keyset en producción + **ADR-0010**
- [ ] Endpoint de reportes con CTEs + window functions
- [ ] Poder explicar los tres primeros en inglés sin notas

---

# Cómo correr cualquier ejercicio

```powershell
. .\scripts\pgq.ps1
pgq docs\perf\scripts\<archivo>.sql
```

La salida queda en `docs/perf/salida/<archivo>.txt`. Los scripts derivan sus parámetros
con `\gset`, así que sobreviven a cualquier re-seed.

Guía operativa con el detalle de qué mirar en cada salida: `docs/perf/GUIA.md`.
