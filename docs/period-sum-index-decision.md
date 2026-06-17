# Decisión — índice para el query del SUM de período

> **Estado: PENDIENTE DE APROBACIÓN.** Recomendación con evidencia. No se aplicó ningún cambio de schema.

## Contexto

El query más caliente de creación de gastos es `sumExpenseAmountByUserCategoryAndPeriod`
(`ScopedTransactionRepository`):

```sql
SELECT COALESCE(SUM(amount), 0)
FROM transactions
WHERE user_id = $1 AND category_id = $2 AND nature = 'expense'
  AND transaction_date >= $period_start AND transaction_date < $period_end;
```

CLAUDE.md (sección *Known gaps*) afirmaba:

> *"Missing partial index for the period-sum query ... Current full-table scans are fine at small scale."*

Esto resultó ser una **deriva de documentación**: el índice **sí existe**.

## Estado real del schema

El migration `InitialSchema1780590020486` crea:

```sql
CREATE INDEX idx_tx_user_cat_nature_date
  ON transactions (user_id, category_id, nature, transaction_date);
```

Ese índice compuesto es un **match de libro** para el query: igualdad en las tres primeras
columnas (`user_id`, `category_id`, `nature`) y rango en la última (`transaction_date`). No hay
full-table scan.

## Evidencia — benchmark (50.000 filas, Postgres 15)

Dataset: 1 usuario, 3 categorías, ambos `nature`, 360 días de 2026. El subconjunto objetivo
(`user, C1, expense, junio`) son ~695 filas de 50.000 (~1,4%). `EXPLAIN ANALYZE` (corrido dentro
de un `BEGIN…ROLLBACK`, sin ensuciar la DB):

**Con el índice compuesto actual:**
```
Aggregate  (cost=863.72..863.73)  (actual time=0.318..0.319)
  -> Bitmap Heap Scan on transactions  (rows=695)
       -> Bitmap Index Scan on idx_tx_user_cat_nature_date  (rows=695)
Execution Time: 0.453 ms
```

**Con un índice parcial añadido** (`... (user_id, category_id, transaction_date) WHERE nature='expense'`):
```
Aggregate  (cost=853.61..853.62)  (actual time=0.447..0.448)
  -> Bitmap Heap Scan on transactions  (rows=695)
       -> Bitmap Index Scan on idx_tx_expense_period  (rows=695)
Execution Time: 0.519 ms
```

| | Índice usado | Cost estimado | Execution real |
| --- | --- | --- | --- |
| Compuesto actual | `idx_tx_user_cat_nature_date` ✓ | 863.72 | 0.453 ms |
| + parcial | `idx_tx_expense_period` | 853.61 | 0.519 ms |

La diferencia de cost es ~1% y el tiempo real es indistinguible (ruido de medición). Ambos planes
son un Bitmap Index Scan sub-milisegundo.

## Recomendación

**NO agregar el índice parcial ahora.** El índice compuesto ya cubre el query y el planner lo usa.
El único beneficio teórico del parcial es **tamaño** (indexa solo filas `expense` y omite `nature`
de la clave), lo cual recién importa a una escala muy superior (millones de filas, donde el costo
de almacenamiento y la write-amplification del índice se vuelven relevantes).

**Revisar de nuevo si y solo si:** la tabla crece a millones de filas Y el monitoreo muestra que el
tamaño del índice o la latencia de escritura son un problema. En ese punto, medir con datos reales
antes de decidir.

## Si se decide agregarlo en el futuro (migración lista)

El índice parcial **no se puede declarar con el decorador `@Index` de TypeORM 0.3** (no modela
índices parciales), así que iría como SQL crudo en una migración — y hay que recordar que reintroduce
deriva entidad↔DB (la entidad no lo refleja). SQL:

```sql
-- up()
CREATE INDEX idx_tx_expense_period
  ON transactions (user_id, category_id, transaction_date)
  WHERE nature = 'expense';

-- down()
DROP INDEX idx_tx_expense_period;
```

## Acción de documentación pendiente (para aprobación)

Corregir la deriva en tres lugares que hoy dicen "falta el índice / full-table scans":

1. **CLAUDE.md** → sección *Known gaps*: el índice compuesto existe; reescribir como "índice parcial
   es una optimización futura opcional, no un gap".
2. **`transaction.orm.entity.ts`** (comentario líneas ~16-22): el comentario dice "este es el query más
   crítico ... idealmente sería un índice parcial ... Fix real: agregarlo". Atemperar a "el índice
   compuesto ya lo cubre; el parcial sería una optimización a gran escala".
3. **`transactions/notes.md`**: el texto del índice compuesto está correcto; solo verificar que no
   repita la narrativa de "full-table scan".
