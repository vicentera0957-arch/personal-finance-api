# E15 · El xmin horizon — runbook de dos sesiones

También necesita dos sesiones, por eso no es un `.sql`. **Es el mejor ejercicio
de la lista**: reproduce con tus manos el incidente #1 real de Postgres en
producción — una transacción abierta y olvidada impide limpiar tuplas muertas de
**toda** la base, no solo de las tablas que esa transacción tocó.

## Preparación

Dos terminales, cada una con:

```powershell
docker compose exec postgres psql -U finance_user -d personal_finance_db
```

Y en cada una, confirmá que son backends distintos:

```sql
SELECT pg_backend_pid();
```

---

## Los pasos

| # | Sesión A (la "olvidada") | Sesión B (la que trabaja) |
| --- | --- | --- |
| 1 | | `SELECT relname, n_dead_tup, pg_size_pretty(pg_relation_size(relid)) FROM pg_stat_user_tables WHERE relname='transactions';` |
| 2 | `BEGIN;` | |
| 3 | `SELECT count(*) FROM accounts;` | |
| 4 | `SELECT txid_current(), now();` ← **dejala abierta, no toques más esta terminal** | |
| 5 | | `DELETE FROM transactions WHERE description LIKE 'e14%' OR description LIKE 'e8%';` |
| 6 | | Si borró pocas filas, usá esto para generar 10.000 muertas: `UPDATE transactions SET description='e15' WHERE user_id='7afba7e7-5856-4bd5-8cce-57887f4b1947' AND transaction_date >= '2026-06-01' AND transaction_date < '2026-07-01';` |
| 7 | | `SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname='transactions';` |
| 8 | | `VACUUM (VERBOSE) transactions;` |
| 9 | | `SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname='transactions';` ← **no bajó** |

En el paso 8, leé la salida del `VERBOSE` con atención. Va a decir algo como
`N dead row versions cannot be removed yet, oldest xmin: NNNN`. Ese
`oldest xmin` es la sesión A.

Ahora, desde **B**, mirá quién está reteniendo el horizonte:

```sql
SELECT pid,
       state,
       age(backend_xmin)          AS transacciones_de_retraso,
       now() - xact_start         AS abierta_hace,
       left(query, 60)            AS ultima_query
FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL
ORDER BY age(backend_xmin) DESC;
```

Y el horizonte global:

```sql
SELECT datname, age(datfrozenxid) FROM pg_database ORDER BY 2 DESC;
```

## Cerrar el círculo

| # | Sesión A | Sesión B |
| --- | --- | --- |
| 10 | `COMMIT;` (o `ROLLBACK;`, da igual) | |
| 11 | | `VACUUM (VERBOSE) transactions;` |
| 12 | | `SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname='transactions';` ← **ahora sí bajó** |

## Qué anotar

- `n_dead_tup` en los pasos 7, 9 y 12.
- La línea `dead row versions cannot be removed yet, oldest xmin: N` textual.
- `age(backend_xmin)` de la sesión A justo antes de cerrarla.
- Que la sesión A **solo leyó `accounts`** y aun así bloqueó la limpieza de
  `transactions`.

## Las preguntas

1. La sesión A hizo un `SELECT` sobre `accounts` y nada más. ¿Por qué impide
   limpiar tuplas muertas de `transactions`?
2. ¿Qué habría pasado si en vez de 10.000 filas muertas hubieran sido 10 millones,
   y la sesión A hubiera quedado abierta un fin de semana?
3. En tu API, ¿qué código podría dejar una transacción abierta sin querer?
   Pista: mirá `TypeOrmTransactionRunner.run()` y preguntate qué pasa si el
   `work(ctx)` nunca resuelve.

## Cierre

```sql
UPDATE transactions SET description = NULL WHERE description = 'e15';
VACUUM transactions;
ANALYZE transactions;
```

> Si querés capturar evidencia de la sesión B, corré sus pasos como un `.sql` con
> `pgq` **mientras** A está abierta. La sesión A siempre es manual.
