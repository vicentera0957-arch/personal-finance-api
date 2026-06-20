# Módulo `transactions` — Histórico y post-mortems

> Registro de bugs de concurrencia ya **cerrados**, conservado para que futuros contribuyentes no rehagan el análisis. El estado **actual** del módulo vive en [notes.md](./notes.md).
>
> Los races que **cruzan módulos** — Race 1 (`DELETE /budgets/:id` vs `POST /transactions`) y Race 2 (mutaciones de cuenta vs `POST /transactions`) — están documentados centralmente en [docs/history/race-conditions-fix-2026-05.md](../../../../docs/history/race-conditions-fix-2026-05.md). Aquí solo viven los bugs cuyo análisis es propio de `transactions`.

---

## Race conditions resueltas (abril 2026)

### Bug A — Write skew en budget limit (RESUELTO)

**Escenario original:** User tenía budget limit=$100, había gastado $80.
1. `PATCH /budgets/X/limit` → `UpdateBudgetLimitUseCase` abría UoW, leía budget sin lock, cambiaba limit a $60, hacía commit.
2. Simultáneamente: `POST /transactions` expense $20 → leía budget FUERA del UoW (la línea ~111 usaba `getBudgetByUserCategoryPeriodUseCase` global, no el repo escopado) → veía limit=$100 → $80+$20=100 ≤ 100 → insertaba.
3. Resultado: el user gastaba $100 pero el limit era $60. R8 violada.

**Archivos afectados:** `create-transaction.use-case.ts` (segunda lectura de budget) y `unit-of-work.impl.ts` (`ScopedBudgetRepository.findById` y `findByUserIdAndCategoryIdAndPeriod`).

**Solución aplicada:**
1. La segunda lectura del budget en `CreateTransactionUseCase` se movió **dentro** del UoW: ahora usa `uow.getBudgetRepository().findByUserIdAndCategoryIdAndPeriod(...)` en vez del use case global. Esta lectura ahora viaja por el `QueryRunner` activo y participa de la misma transacción de PG.
2. `ScopedBudgetRepository.findByUserIdAndCategoryIdAndPeriod` agregó `lock: { mode: 'pessimistic_write' }` → emite `SELECT ... FOR UPDATE`.
3. `ScopedBudgetRepository.findById` agregó el mismo lock → protege también el lado de `UpdateBudgetLimitUseCase`.

**Por qué funciona:** ambos flujos (`CreateTransaction` y `UpdateBudgetLimit`) ahora compiten por el mismo lock de fila sobre el budget. PostgreSQL serializa: el segundo en llegar espera al COMMIT del primero antes de leer, garantizando que el limit visto sea el vigente.

### Bug A.2 — Stale sum vs phantom inserts en período vacío (RESUELTO)

**Escenario original (post Bug A):** dos `POST /transactions` concurrentes de expense sobre un período **vacío** (sin gasto previo). El flujo era `SUM FOR UPDATE` → `SELECT budget FOR UPDATE` → validar → insertar.

1. TX A ejecuta `SUM ... FOR UPDATE` sobre 0 filas → sum=0. **`FOR UPDATE` sobre un resultset vacío no lockea nada** (no hay filas que lockear; phantoms no se previenen).
2. TX B ejecuta `SUM ... FOR UPDATE` sobre 0 filas → sum=0. Tampoco lockea nada.
3. TX A toma `SELECT budget FOR UPDATE`, valida `0 + 60 ≤ 100` ✓, inserta, COMMIT.
4. TX B espera el lock del budget, despierta, valida con el `sum=0` **stale** que leyó en (2), `0 + 60 ≤ 100` ✓, inserta, COMMIT.
5. Total real $120 > $100. R8 violada.

**Por qué el test original no lo detectaba:** partía de $90 ya gastados → el `FOR UPDATE` del `SUM` agarraba filas reales y serializaba **por casualidad**. La corrección no debía depender del estado de los datos.

**Archivos afectados:** `create-transaction.use-case.ts` (orden de operaciones dentro del UoW) y `unit-of-work.impl.ts` (`ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod`).

**Solución aplicada:**
1. **Reordenar** el bloque expense en `CreateTransactionUseCase`: primero `budgetRepo.findByUserIdAndCategoryIdAndPeriod(...)` (gate), después `txRepo.sumExpenseAmountByUserCategoryAndPeriod(...)`.
2. **Quitar** el `setLock('pessimistic_write')` redundante de `ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod`. Con el gate del budget, ese lock no agrega correctitud y sí agrega contención con lecturas concurrentes.
3. Test de regresión en `test/integration/concurrency/concurrency.integration.spec.ts` que reproduce el escenario de período vacío.

**Por qué funciona:** una vez que el budget row es el mutex, dos TX competidoras se serializan en el `SELECT budget FOR UPDATE`. La que despierta segunda ejecuta su `SUM` como un **statement nuevo** post-COMMIT del ganador; en `READ COMMITTED` ese statement ve los datos commiteados al momento de ejecutarse, así que el `sum` incluye el INSERT de la ganadora. El invariante se valida con datos frescos sin necesidad de elevar a `SERIALIZABLE`.

**Patrón:** `UpdateBudgetLimitUseCase` ya lo aplicaba (lock del budget primero, luego recalcular sumatoria). Este cambio alinea `CreateTransaction` con el mismo patrón. La regla generalizada: **cualquier dato que entre en la decisión del invariante debe leerse después de adquirir el lock del gate**.

### Bug B — Lost update en balance de cuenta (RESUELTO)

**Escenario original:** Dos requests concurrentes `POST /transactions` sobre la misma cuenta.
1. TX1 leía `account.balance = $1000` (sin lock)
2. TX2 leía `account.balance = $1000` (sin lock)
3. TX1 calculaba $1000 + $500 = $1500, escribía
4. TX2 calculaba $1000 - $300 = $700, escribía → **los $500 de TX1 se perdían**

**Archivo afectado:** `unit-of-work.impl.ts` — `ScopedAccountRepository.findById` usaba `manager.findOne` sin lock.

**Solución aplicada:** `ScopedAccountRepository.findById` agregó `lock: { mode: 'pessimistic_write' }` → emite `SELECT ... FOR UPDATE`.

**Por qué funciona sin tocar `UpdateAccountBalanceUseCase`:** ese use case (en `accounts/application/`) es agnóstico al mecanismo del repo. Recibe `IAccountRepository` y llama `findById` — cuando el UoW le inyecta el repo escopado, hereda el lock automáticamente. Buena separación de responsabilidades: el dominio de accounts no necesita saber de transacciones SQL.
