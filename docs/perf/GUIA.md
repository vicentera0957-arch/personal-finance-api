# Guía de ejecución del lab

Todo está escrito. Esto es lo que corrés, en qué orden, y qué tenés que mirar en
cada salida.

**Antes de cada sesión**, una sola vez:

```powershell
docker compose up -d postgres
. .\scripts\pgq.ps1
```

Y la regla que gobierna todo: **ejercicio sin número medido no cuenta.** Cada
`pgq` deja la evidencia en `docs/perf/salida/`; la conclusión la escribís vos en
`PERFORMANCE.md`.

---

## Orden de ejecución

```text
setup → E1 ✅ → E2 → E3 → E4 → E5 → E6 → E7 → E8
      → E17a → E17b → E17c
      → E19 → E20 → E21
      → E9 → E10 → E11 → E12
      → E13 → E14 → E15 → E16
      → limpieza
```

**Dependencias duras.** E1 antes de E5 (necesitás el "antes"). E5 antes de E6 y
de E8 (los dos usan los índices que E5 crea). E6 antes de E7 (`Heap Fetches`
solo existe dentro de un Index Only Scan). E17b antes de E17c. E19 antes de E20
(el join que analizás sale del reporte). E8 y E14 antes de E16 (sin bloat previo,
E16 no tiene nada que medir).

---

## Bloque 1 · Línea base

### E1 — Baseline crudo ✅ hecho

`docs/perf/salida/e1-baseline.txt` · `PERFORMANCE.md` §1

### E2 — La selectividad decide, no el volumen · ~40 min

```powershell
pgq docs\perf\scripts\e2-selectividad.sql
```

Seis filtros sobre la misma tabla, del 94,6% al 0,004%. La sección 0 imprime las
fracciones reales antes de medir nada.

**Mirá:** el nodo elegido en cada uno. Vas a ver los tres escalones —
`Seq Scan`, `Bitmap Heap Scan`, `Index Scan` — y en algún punto entre A y F
el planner cambia de opinión.

**Anotá:** una fila por filtro con filas devueltas · fracción · nodo · buffers ·
execution time.

**La pregunta:** ¿entre qué dos filtros está el umbral, y qué fracción de la
tabla es? La sección G fuerza un Seq Scan sobre el caso más selectivo: comparar
ese costo con el real te dice **cuánto** creía Postgres que ganaba.

**Trampa:** el filtro C (ballena, 21%) devuelve 200k filas y el A casi un millón.
No mires el tiempo, mirá los buffers.

### E3 — Leer buffers, no milisegundos · ~30 min

```powershell
docker compose restart postgres
pgq docs\perf\scripts\e3a-frio.sql
pgq docs\perf\scripts\e3b-caliente.sql
```

Los dos comandos van seguidos, sin nada en el medio. Si explorás entre uno y otro
calentás el cache y arruinás la medición fría.

**Mirá:** `shared read` en e3a contra `shared hit` en e3b, y las líneas
`I/O Timings: read=N`. El total `hit + read` tiene que ser **el mismo** en las
tres corridas; lo único que cambia es de dónde salieron.

**Anotá:** hit · read · I/O Timings · execution time, para la query chica y la
grande por separado.

**Trampa importante:** `docker compose restart` vacía `shared_buffers` de
Postgres, pero **no** el page cache del kernel — que en Windows vive dentro de la
VM de Docker. Así que tus "reads" pueden salir sospechosamente rápidos: son
lecturas al SO, no al disco. Documentalo, no lo escondas. Para un frío de verdad
haría falta `docker compose down` y volver a levantar.

### E4 — Estimado vs. real · ~35 min

```powershell
pgq docs\perf\scripts\e4-estimado-vs-real.sql
```

Mide, inserta 5.000 filas concentradas en el mismo período, mide sin `ANALYZE`,
corre `ANALYZE`, mide otra vez, y hace `ROLLBACK`.

**Mirá:** `rows=` estimado contra `actual rows=` en los pasos 4.1, 4.3 y 4.5.
En 4.3 el catálogo miente a propósito.

**Y mirá esto sobre todo:** el paso 4.6 corre después del `ROLLBACK` y pregunta
si las estadísticas también volvieron atrás. **No te adelanto la respuesta** —
es lo más interesante del ejercicio y la razón por la que el script termina con
un `ANALYZE` incondicional en 4.7.

**La pregunta:** en 4.3 el planner tomó una decisión con información falsa.
¿Eligió mal? ¿Y si hubieran sido 500.000 filas en vez de 5.000?

---

## Bloque 2 · Índices que cambian el plan

### E5 — Partial index · ~45 min

```powershell
pgq docs\perf\scripts\e5-partial-index.sql
```

Crea `idx_tx_expense_period` con `CONCURRENTLY`, re-mide la query de E1, y
después hace dos comparaciones: sin el índice nuevo, y con un índice de **orden
equivocado** (la columna de rango primero).

**Mirá:** el tamaño del índice parcial contra el completo, y el nodo/buffers
antes y después.

**El dato incómodo, no lo maquilles:** el 94,6% de las filas son `expense`, así
que el índice parcial excluye apenas un 5,4%. En este dataset su valor **no es**
el tamaño — es la especialización al patrón de query. Escribilo así en
`PERFORMANCE.md`.

**La sección 5.5 es la importante.** Tu índice pone `transaction_date` al final:
igualdades primero, rango último. El contraejemplo invierte el orden y te muestra
qué pasa. Es la regla que más se equivoca en producción.

**Trampa:** `CREATE INDEX CONCURRENTLY` no corre dentro de una transacción. Por
eso el script no tiene `BEGIN` alrededor.

### E6 — Covering index → Index Only Scan · ~35 min

```powershell
pgq docs\perf\scripts\e6-covering-index.sql
```

**Mirá:** que aparezca `Index Only Scan` en 6.3, y la línea `Heap Fetches: N`
debajo. En 6.4 y 6.5 el Index Only se rompe a propósito.

**El trade-off a documentar:** `INCLUDE` no es lo mismo que agregar la columna a
la clave. Las columnas incluidas **no sirven para buscar ni para ordenar** — solo
para no ir al heap. Por eso no engordan los nodos internos del árbol. La sección
6.5 filtra por `amount`, que está en el `INCLUDE`: mirá dónde se evalúa ese
predicado.

### E7 — 🔑 `Heap Fetches` · ~30 min

```powershell
pgq docs\perf\scripts\e7a-heap-fetches.sql
pgq docs\perf\scripts\e7b-postvacuum.sql
```

**Por qué son dos archivos:** `VACUUM` no puede correr dentro de una transacción,
y además querés la foto sucia guardada aparte de la limpia.

**Mirá:** `relallvisible / relpages` en 7.0, 7.4 y 7.7 — es el visibility map en
números. Y `Heap Fetches` en 7.1, 7.5 y 7.8.

**La pregunta del checkpoint:** *"What does `Heap Fetches: 0` actually prove?"*
Pista: los índices no guardan información de visibilidad. Ninguna.

**Obligatorio:** e7a apaga el autovacuum de la tabla y **e7b lo vuelve a
prender**. No te saltees e7b.

### E8 — El costo del índice · ~40 min

```powershell
pgq docs\perf\scripts\e8-costo-escritura.sql
```

Cinco mediciones: UPDATE sobre columna no indexada, sobre columna indexada, lo
mismo sin los índices de E5/E6, lo mismo sin ningún índice salvo la PK, y un
INSERT de 20.000 filas con y sin índices. Todo dentro de `BEGIN`/`ROLLBACK`.

**Mirá:** los buffers escritos (`shared dirtied`, `shared written`) más que el
tiempo.

**La conclusión:** write amplification. En un ledger, donde el patrón es
write-heavy, esa asimetría pesa más que en un CRUD.

**Requiere E5 y E6 corridos** — el script hace `DROP INDEX` de los dos.

---

## Bloque 4 · Keyset pagination

### E17a — Medir la degradación · ~30 min

```powershell
pgq docs\perf\scripts\e17a-offset.sql
```

Cinco OFFSET sobre la ballena: 0, 1.000, 10.000, 100.000, 200.000.

**Mirá:** `actual rows` del nodo de abajo contra las 20 filas que devuelve.
Ahí está todo el ejercicio.

**La conclusión:** `OFFSET` no es lento por leer 20 filas — es lento porque
igual tiene que **producir y descartar** las N anteriores. Costo O(offset).

### E17b — Índice que entrega el orden · ~20 min

```powershell
pgq docs\perf\scripts\e17b-orden-indexado.sql
```

**Mirá:** si aparece o no un nodo `Sort`. 17b.1 y 17b.2 ordenan por una columna
indexada; 17b.3 y 17b.4 por `amount`, que no lo está.

**Ojo con una sorpresa:** el índice está declarado `ASC` y la query pide `DESC`.
Puede que igual no haya `Sort`. Si es así, entendé por qué antes de seguir — un
btree se puede recorrer para los dos lados.

**17b.5 es un hallazgo, no un paso decorativo:** cuenta cuántos
`transaction_date` están repetidos. Si hay repetidos, `ORDER BY transaction_date`
sin desempate **no define un orden total**, y eso convierte la paginación actual
en un bug de correctitud, no solo de performance.

### E17c — Keyset + ADR · ~40 min

```powershell
pgq docs\perf\scripts\e17c-keyset.sql
```

**17c.0 demuestra el bug:** corre la misma página con dos planes distintos y
compara los `id`. Si `solo_en_a` no es 0, la paginación de tu API **hoy** puede
saltear o repetir filas.

**Mirá:** buffers del OFFSET 200000 contra los del keyset al mismo punto.

**Después escribí el ADR.** Los `docs/adr/` van del 0000 al 0009, así que este es
el **0010**, no el 0006 que dice el plan. Tiene que decir explícitamente: se
pierde el salto a página arbitraria, se gana costo constante por página, y `page`
sale del contrato de la API para entrar un cursor opaco.

---

## Bloque 5 · SQL analítico y joins

### E19 — Reporte mensual con CTEs + window functions · ~60 min

```powershell
pgq docs\perf\scripts\e19-reporte-mensual.sql
```

Un solo query con CTEs encadenados: gasto por categoría y mes, `SUM() OVER` para
el acumulado, `LAG()` contra el mes anterior, `ROW_NUMBER()` para el top-3.

**Mirá:** 19.4 trae las ~200.000 filas crudas del mismo usuario. Comparar sus
buffers con los de 19.3 es el argumento de *"no traigas 200.000 filas a Node para
sumarlas"*.

**Es el único bloque que produce una feature**, no solo documentación.

### E20 — Estrategia de joins · ~50 min

```powershell
pgq docs\perf\scripts\e20-joins.sql
```

El mismo join de 3 tablas con el planner libre y después forzando cada algoritmo.

**Mirá:** qué algoritmo eligió cada join y con qué estimación de filas. Después,
cuánto empeora cuando lo obligás a otro.

**La conclusión que importa:** cada algoritmo pide una estrategia de indexado
**distinta**. Nested Loop quiere un índice en el lado interno; Hash Join no usa
índices para unir, así que ahí indexás lo que **filtra**, no lo que une. Es el
error conceptual más común al "optimizar joins".

**20.6 verifica que no quedó ningún `enable_*` apagado.** Los `enable_*` son para
aprender, nunca para producción — documentá eso.

### E21 — El N+1 de TypeORM · ~40 min

📄 `docs/perf/scripts/e21-n1-typeorm.md`

No es SQL. Y **tu código no tiene el N+1** — verificarlo es la mitad del
ejercicio, fabricarlo a propósito es la otra mitad. El runbook explica ambas.

---

## Bloque 3 · Concurrencia

📄 `docs/perf/scripts/bloque3-concurrencia.md` · ~2h 30m

E9 a E12 necesitan **dos sesiones psql simultáneas** y no se pueden scriptear. El
runbook tiene el paso a paso en dos columnas.

```powershell
pgq docs\perf\scripts\bloque3-setup.sql      # antes
pgq docs\perf\scripts\bloque3-limpieza.sql   # después
```

E12 (write skew) es el más subestimado y el que más se parece a tu dominio: dos
gastos que por separado caben bajo el límite y juntos lo superan.

---

## Bloque 6 · MVCC visible

### E13 — Ver MVCC físicamente · ~25 min

```powershell
pgq docs\perf\scripts\e13-mvcc-ctid.sql
```

**Mirá:** el `ctid` antes y después del `UPDATE`. "Actualizar" nunca es
modificar en el lugar.

### E14 — HOT updates · ~35 min

```powershell
pgq docs\perf\scripts\e14-hot-updates.sql
```

**Mirá:** `n_tup_upd` contra `n_tup_hot_upd` en los dos casos. Un UPDATE sobre
columna no indexada puede ser HOT; sobre columna indexada, nunca.

**La conclusión:** por qué no se indexan columnas volátiles. Conecta directo con
E8.

### E15 — 👑 El xmin horizon · ~45 min

📄 `docs/perf/scripts/e15-xmin-horizon.md`

Dos sesiones. **Si tenés que recortar el bloque 6, hacé este igual.** Es el
incidente #1 real de Postgres en producción, reproducido con tus manos.

### E16 — Bloat · ~25 min

```powershell
pgq docs\perf\scripts\e16-bloat.sql
```

**Mirá:** que `pg_relation_size` **no baje** después del `VACUUM` normal, y sí
después del `REINDEX CONCURRENTLY`.

**Requiere haber corrido E8/E13/E14 antes** — si no hay bloat, no hay nada que
medir.

---

## Cierre

```powershell
pgq docs\perf\scripts\zz-limpieza-indices.sql
```

Borra los cuatro índices que creó el lab, limpia las filas sintéticas, reactiva
el autovacuum y deja `VACUUM ANALYZE` corrido. Después de esto la tabla vuelve a
tener exactamente los índices del schema original.

Si querés re-verificar que la base quedó medible:

```powershell
pgq docs\perf\scripts\setup.sql
```

---

## Definición de "capa 1 cerrada"

No es haber corrido los ejercicios. Es tener los artefactos:

- [x] `PERFORMANCE.md` con ≥2 EXPLAIN antes/después con números propios — bloque 1 (E1–E4)
- [x] Las anomalías de concurrencia documentadas — ya estaban: `docs/concurrency-model.md`
      + `docs/history/closed-race-conditions.md`, con red de regresión en
      `test/integration/concurrency/`. No hace falta un `CONCURRENCY.md` aparte
- [x] Endpoint de reportes — `GET /reports/summary` ya existe (módulo `reports`).
      Lo que queda pendiente ahí son las CTEs y window functions, no el endpoint
- [ ] Keyset en producción + **ADR-0010**
- [ ] Poder explicar los tres primeros en inglés sin notas
