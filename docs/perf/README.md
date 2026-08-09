# Lab de performance PostgreSQL

Cómo levantar el laboratorio de medición en una máquina nueva, y qué convenciones
gobiernan los artefactos que produce.

**La regla que gobierna todo:** ejercicio sin número medido no cuenta. Cada bloque
cierra con algo escrito en `PERFORMANCE.md` / `docs/CONCURRENCY.md` o un commit.

---

## Artefactos

| Ruta | Qué es | ¿Se commitea? |
| --- | --- | --- |
| `docs/perf/*.sql` | El experimento. Reproducible por cualquiera. | sí |
| `docs/perf/out/*.txt` | La salida cruda de psql. **Es la evidencia.** | sí |
| `PERFORMANCE.md` | La narrativa con las conclusiones (§1 baseline · §2 índices · §4 keyset · §5 analítico) | sí |
| `docs/CONCURRENCY.md` | Las 4 anomalías de concurrencia | ver "Bloque 3" abajo |

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

El servicio monta `./docker/psqlrc` en `/root/.psqlrc` dentro del contenedor
(`\timing on`, sin paginador, `ON_ERROR_STOP`). Al estar versionado y montado,
sobrevive tanto al `docker compose restart postgres` que pide **E3** como a
recrear el contenedor entero.

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

Defaults: 15.000 transacciones · 50 usuarios · 12 meses · skew Pareto 1.1.
El script corre `ANALYZE` solo al terminar.

### 4. Gate

```powershell
. .\scripts\pgq.ps1
pgq docs\perf\e0-gate.sql
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
| `pgq <archivo.sql>` | Correr un experimento y capturar la evidencia en `docs/perf/out/<nombre>.txt` | sí |

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

`e0-gate.sql` es idempotente. Volvé a correrlo:

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

Decisión pendiente al llegar al Bloque 2: correr E5 como experimento
(crear → medir → `DROP`, sin migration commiteada) o revertir la decisión documentada.
Si se crea la migration, hay que actualizar ese doc y `CLAUDE.md` en el mismo PR.

Nota adicional del dataset: con **91,43% de filas `expense`**, un índice parcial
`WHERE nature = 'expense'` excluye apenas el 8,57%. No maquillar ese número.

### ADR-0006 ya está ocupado

La lista pide "ADR-0006 keyset pagination", pero
[`docs/adr/0006-domain-exceptions-vs-http.md`](../adr/0006-domain-exceptions-vs-http.md)
ya existe. Ocupados: 0000–0009. **El keyset es ADR-0010.**

### E17a exige re-seed, y eso invalida los números anteriores

E17a necesita un usuario con >10.000 transacciones:

```powershell
$env:SEED_USERS=200; $env:SEED_TX_COUNT=200000; node scripts/populate.mjs --reset
```

Eso cambia el dataset bajo los pies de los Bloques 1 y 2, ya medidos sobre 15.000
filas. **Los números no son comparables entre datasets.** Cada tabla de
`PERFORMANCE.md` tiene que decir sobre qué tamaño se midió; la cabecera con fecha que
`pgq` escribe en cada `.txt` es el respaldo.

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

## Línea base del Gate (2026-08-07, 15.000 filas)

Evidencia completa: [`out/e0-gate.txt`](out/e0-gate.txt).

| Chequeo | Criterio | Resultado |
| --- | --- | --- |
| `count(*)` | ~15.000 | **15.000** ✅ |
| `reltuples` | cercano al real, nunca −1 ni 0 | **15.000** (exacto) ✅ |
| Curva por usuario | decreciente | **26,10% → 0,353%**, ratio 73,9x ✅ |
| `correlation` `transaction_date` | cercano a 1 | **1.0000** ✅ |
| Reparto `nature` | ~92% / ~8% | **91,43% expense / 8,57% income** ✅ |
| `track_io_timing` | `on` | **on** ✅ |
| `v_period_expenses` | existe | **existe** ✅ |

**Camino A de E2 habilitado.** La Pareto del seed produce un rango de selectividad de
73,9x. El usuario más grande (`seed-load-user-1`, 3.915 tx, 26,10%) y el más chico
(`seed-load-user-50`, 53 tx, 0,353%) son los dos parámetros de E1/E2. Los UUID están
en `out/e0-gate.txt` §3 y §3b.

**Un dato que ya vale para E8:** los índices de `transactions` pesan **16 MB** contra
un heap de **2 MB** — 8x más índice que datos. `idx_tx_user_cat_nature_date` solo ya
son 5.992 kB. Eso es exactamente la write amplification que E8 va a medir, y el
argumento más fuerte contra agregar índices a la ligera en una tabla write-heavy.

**Otro dato, para E6:** `correlation` de `user_id` es **0,1015** — las filas de un
mismo usuario están dispersas por todo el heap, como en producción. Eso es lo que
hace caro el random I/O de un Index Scan y lo que le da sentido al Index Only Scan.

**Mes cerrado más reciente para medir:** `2026-07` (1.592 filas). El mes corriente
(`2026-08`) está truncado al día de hoy — el seed nunca genera fechas futuras.
