# Bloque 3 · Concurrencia (E9–E12) — runbook de dos sesiones

Estos cuatro ejercicios **no pueden ser un `.sql`**. Un script es una sesión y es
secuencial; acá hacen falta dos sesiones intercalando pasos. No hay forma de
scriptearlo, así que esto es un runbook: cada fila es un paso, y la columna te
dice en qué terminal va.

## Preparación (una sola vez)

```powershell
. .\scripts\pgq.ps1
pgq docs\perf\scripts\bloque3-setup.sql
```

Crea dos cuentas de laboratorio con 100.000 de saldo y un presupuesto de 100.000
para septiembre 2026 sin gasto previo. Nada de esto toca los datos del seed.

Después abrí **dos terminales de PowerShell** y en cada una:

```powershell
docker compose exec postgres psql -U finance_user -d personal_finance_db
```

Verificá que son backends distintos antes de empezar — si por algún motivo
comparten proceso, todo lo que sigue da resultados falsos:

```sql
SELECT pg_backend_pid();
```

> ⚠️ **No uses DBeaver ni pgAdmin.** Trabajan en autocommit y pueden reconectar
> en silencio: tu "sesión A" podría dejar de ser el mismo backend a mitad del
> ejercicio y el resultado sería silenciosamente equivocado.

Constantes que vas a pegar:

```text
cuenta A   aaaaaaaa-0000-0000-0000-000000000001
cuenta B   aaaaaaaa-0000-0000-0000-000000000002
usuario    7afba7e7-5856-4bd5-8cce-57887f4b1947
categoria  98de0404-ead4-4c77-9cb3-5875f282a936
presupuesto de septiembre 2026: limite 100.000, gastado 0
```

Al terminar los cuatro:

```powershell
pgq docs\perf\scripts\bloque3-limpieza.sql
```

---

## E9 — Reproducir el lost update

Dos retiros concurrentes de la misma cuenta, **sin lock**. Simula lo que hace una
app que lee el saldo, calcula en memoria y escribe el resultado.

| # | Sesión A | Sesión B |
| --- | --- | --- |
| 1 | `BEGIN;` | |
| 2 | `SELECT current_balance FROM accounts WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';` | |
| 3 | | `BEGIN;` |
| 4 | | `SELECT current_balance FROM accounts WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';` |
| 5 | `UPDATE accounts SET current_balance = 100000 - 30000 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';` | |
| 6 | `COMMIT;` | |
| 7 | | `UPDATE accounts SET current_balance = 100000 - 50000 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';` |
| 8 | | `COMMIT;` |
| 9 | `SELECT current_balance FROM accounts WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';` | |

**Qué anotar:** el saldo final. Se retiraron 30.000 y 50.000 de 100.000, así que
debería quedar 20.000.

**La pregunta:** ¿en qué paso exacto se perdió la plata, y por qué el paso 7 no
falló ni avisó nada?

**Y la que importa:** `READ COMMITTED` garantiza que nunca leés datos sin
commitear. Eso se cumplió en todo momento. ¿Por qué entonces no te salvó?

---

## E10 — El mismo escenario con `SELECT … FOR UPDATE`

Restaurá el saldo antes de empezar:

```sql
UPDATE accounts SET current_balance = 100000 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
```

| # | Sesión A | Sesión B |
| --- | --- | --- |
| 1 | `BEGIN;` | |
| 2 | `SELECT current_balance FROM accounts WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' FOR UPDATE;` | |
| 3 | | `BEGIN;` |
| 4 | | `SELECT current_balance FROM accounts WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001' FOR UPDATE;` ← **se queda colgada** |
| 5 | `UPDATE accounts SET current_balance = 100000 - 30000 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';` | (sigue colgada) |
| 6 | `COMMIT;` | ← se destraba y devuelve **70000**, no 100000 |
| 7 | | `UPDATE accounts SET current_balance = 70000 - 50000 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';` |
| 8 | | `COMMIT;` |
| 9 | `SELECT current_balance FROM accounts WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';` | |

Mientras B está colgada en el paso 4, mirá el lock desde A:

```sql
SELECT pid, locktype, mode, granted, relation::regclass
FROM pg_locks WHERE NOT granted;
```

**Qué anotar:** el saldo final, cuánto tiempo estuvo B bloqueada, y el valor que
B leyó en el paso 6.

**Conectalo con tu código:** este es exactamente
`ScopedAccountRepository.findByIdWithLock`, y `CreateTransactionUseCase` lo hace
antes de tocar el balance. Andá a leerlo después de correr esto.

**La pregunta:** el `FOR UPDATE` cuesta throughput — B esperó. ¿Cuál es la
alternativa y por qué en un ledger no sirve?

---

## E11 — Provocar un deadlock a propósito

Dos sesiones tomando las mismas dos filas **en orden inverso**.

| # | Sesión A | Sesión B |
| --- | --- | --- |
| 1 | `BEGIN;` | `BEGIN;` |
| 2 | `UPDATE accounts SET current_balance = current_balance - 1 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';` | |
| 3 | | `UPDATE accounts SET current_balance = current_balance - 1 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';` |
| 4 | `UPDATE accounts SET current_balance = current_balance - 1 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';` ← **se cuelga** | |
| 5 | | `UPDATE accounts SET current_balance = current_balance - 1 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';` |

En el paso 5 Postgres detecta el ciclo y **mata a una de las dos** con
`ERROR: deadlock detected` (SQLSTATE `40P01`). Cerrá la que sobrevivió con
`ROLLBACK;` y la muerta también.

**Qué anotar:** el mensaje completo del error — incluye `Process N waits for …`,
que es el ciclo dibujado. Y el tiempo hasta que apareció: no es instantáneo,
Postgres espera `deadlock_timeout` (1s por defecto) antes de siquiera buscar
ciclos.

**La pregunta:** un reintento automático haría que este par de transacciones
funcione. ¿Por qué la solución correcta igual **no** es reintentar?

---

## E12 — Write skew (el más importante del bloque)

Dos gastos que **por separado** caben bajo el límite y **juntos** lo superan.
Presupuesto: límite 100.000, gastado 0. Cada sesión inserta 60.000.

### Ronda 1 — `REPEATABLE READ`

| # | Sesión A | Sesión B |
| --- | --- | --- |
| 1 | `BEGIN ISOLATION LEVEL REPEATABLE READ;` | `BEGIN ISOLATION LEVEL REPEATABLE READ;` |
| 2 | Leer el gastado (query ↓) → `0` | |
| 3 | | Leer el gastado (query ↓) → `0` |
| 4 | 0 + 60000 ≤ 100000 ✓ → insertar (query ↓) | |
| 5 | | 0 + 60000 ≤ 100000 ✓ → insertar (query ↓) |
| 6 | `COMMIT;` | |
| 7 | | `COMMIT;` |

Query de lectura (la misma que corre tu `CreateTransactionUseCase`):

```sql
SELECT COALESCE(SUM(e.amount), 0) AS gastado
FROM v_period_expenses e
WHERE e.user_id          = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id      = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-09-01'
  AND e.transaction_date <  '2026-10-01';
```

Query de inserción (cambiá `lab-b3-A` por `lab-b3-B` en la sesión B):

```sql
INSERT INTO transactions (id, user_id, account_id, category_id, nature, amount, description, transaction_date, created_at)
VALUES (gen_random_uuid(),
        '7afba7e7-5856-4bd5-8cce-57887f4b1947',
        'aaaaaaaa-0000-0000-0000-000000000001',
        '98de0404-ead4-4c77-9cb3-5875f282a936',
        'expense', 60000, 'lab-b3-A',
        TIMESTAMP '2026-09-15 12:00:00', now());
```

Verificación final:

```sql
SELECT COALESCE(SUM(e.amount), 0) AS gastado, 100000 AS limite
FROM v_period_expenses e
WHERE e.user_id = '7afba7e7-5856-4bd5-8cce-57887f4b1947'
  AND e.category_id = '98de0404-ead4-4c77-9cb3-5875f282a936'
  AND e.transaction_date >= '2026-09-01' AND e.transaction_date < '2026-10-01';
```

**Los dos commits pasan.** El invariante quedó roto y nadie se enteró.

### Ronda 2 — `SERIALIZABLE`

Borrá lo insertado y repetí **exactamente los mismos pasos** cambiando el nivel:

```sql
DELETE FROM transactions WHERE description LIKE 'lab-b3%';
```

| # | Sesión A | Sesión B |
| --- | --- | --- |
| 1 | `BEGIN ISOLATION LEVEL SERIALIZABLE;` | `BEGIN ISOLATION LEVEL SERIALIZABLE;` |
| … | (idénticos a la ronda 1) | |
| 7 | | `COMMIT;` ← **falla con `40001`** |

**Qué anotar:** el mensaje exacto (`could not serialize access due to read/write
dependencies among transactions`) y en qué paso apareció — no en el `INSERT`,
sino en el `COMMIT`.

### Ronda 3 — cómo lo resuelve tu código

Repetí la ronda 1 (`READ COMMITTED`, el default), pero agregando **antes de leer
el gastado** el `FOR UPDATE` sobre la fila del presupuesto:

```sql
SELECT * FROM budgets WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001' FOR UPDATE;
```

**Qué anotar:** B se cuelga en ese `SELECT` y no avanza hasta que A commitea;
cuando avanza, lee el gastado **ya actualizado** y su chequeo falla correctamente.

**La conclusión que tenés que poder defender:** hay dos formas de cerrar un write
skew — subir a `SERIALIZABLE`, o materializar el conflicto en una fila concreta y
lockearla. Tu sistema eligió la segunda. Andá a `CLAUDE.md`, sección "Concurrency",
y leé por qué: la fila de `budgets` funciona como **mutex lógico** de su propio
invariante, y por eso los tres agregados (`SUM`/`COUNT`) no llevan lock propio —
Postgres prohíbe `FOR UPDATE` sobre agregados, así que los serializa el lock que
el caller tomó antes.

**La pregunta de cierre:** ¿qué te cuesta `SERIALIZABLE` que no te cuesta el
lock de fila, y al revés?

---

## Entregable

`docs/CONCURRENCY.md` con las cuatro anomalías reproducidas (pasos + salida real
+ mensajes de error textuales) y la justificación del lock del UoW.

**Checkpoint en inglés:** *"Walk me through how two concurrent transfers could
double-spend, and what you did about it."*
