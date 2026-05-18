# Módulo `transactions` — Referencia actual

## Dominio

### Value objects

**`TransactionNature`** (`domain/value-objects/transaction-nature.vo.ts`)  
Valores válidos: `income` | `expense`. Separado de `CategoryNature` intencionalmente — son bounded contexts distintos que pueden evolucionar independientemente. No incluye `transfer` (las transferencias son una entidad separada en el esquema de BD).

**`Amount`** (`domain/value-objects/amount.vo.ts`)  
Monto de una transacción en CLP. Validaciones: número finito, entero, estrictamente mayor que cero. Separado de `Balance` (que pertenece a `accounts`) porque representan conceptos distintos: `Amount` es un monto puntual, `Balance` es un saldo acumulado. `Balance` permite cero; `Amount` no.

### Entidad `Transaction`

Constructor privado. Dos factory methods:
- `Transaction.create(props)` — genera `createdAt`
- `Transaction.reconstitute(props)` — reconstruye desde persistencia sin generar timestamps

Propiedades: `id`, `userId`, `accountId`, `categoryId`, `nature` (`TransactionNature`), `amount` (`Amount`), `description?`, `transactionDate`, `createdAt`.

Sin `updatedAt` — las transacciones son registros contables inmutables. Corrección = eliminar + recrear.

Sin métodos de mutación (solo getters). Esto refleja que una transacción contable no "se edita"; se contra-asienta.

### Excepciones de dominio

| Excepción | Cuándo |
|-----------|--------|
| `TransactionNotFoundException` | `findById` retorna null |
| `IncompatibleCategoryNatureException` | `category.nature !== transaction.nature` (R7) |
| `BudgetLimitExceededException` | Gasto proyectado > `budget.limit` |
| `BudgetRequiredForExpenseTransactionException` | Expense sin budget en el período |
| `CannotDeleteTransactionException` | Revertir un income dejaría el balance negativo |

### Puerto `ITransactionRepository`

Clase abstracta (necesario para DI en NestJS). Métodos:
- `findById`, `findByAccountId`, `findByUserId`, `save`, `delete`
- `sumExpenseAmountByUserCategoryAndPeriod` — query de suma para validar R8

### Puerto `IUnitOfWork`

Clase abstracta definida en `domain/IUnitOfWork.ts`. Expone:
- `begin()`, `commit()`, `rollback()`, `release()`, `isActive()`
- `getTransactionRepository()` → `ITransactionRepository` escopado
- `getAccountRepository()` → `IAccountRepository` escopado
- `getBudgetRepository()` → `IBudgetRepository` escopado

Los repositorios escopados comparten el `EntityManager` del `QueryRunner` activo. Cada operación dentro del UoW corre en la misma transacción de PostgreSQL.

---

## Capa application

### `CreateTransactionUseCase`

**Flujo pre-transacción (fuera del UoW):**
1. Crea VOs `TransactionNature` y `Amount`
2. Valida que la cuenta existe y pertenece al usuario (`GetAccountByIdUseCase`)
3. Valida que la categoría existe, pertenece al usuario, y su naturaleza coincide con la transacción (R7)
4. Si es expense: valida `isBudgetable=true` y que existe un budget para el período (falla rápido sin abrir la transacción)

**Flujo dentro del UoW:**
1. `uow.begin()` — abre `QueryRunner`, inicia transacción de PG
2. `budgetRepo.findByUserIdAndCategoryIdAndPeriod(...)` (repo escopado, `FOR UPDATE` implícito) — **gate del invariante**: lockea la fila del budget del período antes de leer cualquier dato que entre en la decisión. Es el único objeto que existe siempre y por el que pasan todos los escritores concurrentes del período.
3. `txRepo.sumExpenseAmountByUserCategoryAndPeriod(...)` (sin lock propio) — se ejecuta post-gate, así que en `READ COMMITTED` ve los commits previos. La consistencia la da el lock del budget, no un `FOR UPDATE` sobre el rango (que no previene phantoms).
4. `UpdateAccountBalanceUseCase(acctRepo).execute(...)` — actualiza balance usando el repositorio escopado (lock pesimista implícito en `findById`)
5. `txRepo.save(transaction)` — persiste la transacción
6. `uow.commit()` / `uow.rollback()` en `finally`

### `DeleteTransactionUseCase`

Similar al create pero en reversa:
1. Recupera la transacción y la cuenta
2. Verifica que el owner coincide
3. `uow.begin()` — revert del balance + delete de la transacción en un mismo `QueryRunner`
4. Si el revert de un income dejaría el balance negativo → `CannotDeleteTransactionException`

### Use cases de lectura

`GetTransactionByIdUseCase`, `GetTransactionsByAccountIdUseCase`, `GetTransactionsByUserIdUseCase` — sin complejidad especial. Los de colección soportan paginación (`offset`, `limit`) y filtro por rango de fechas (`from`, `to`).

---

## Capa infrastructure

### `TransactionOrmEntity`

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | `uuid` | PK, generado con `randomUUID()` en el use case |
| `userId` | `varchar` | Referencia lógica |
| `accountId` | `varchar` | Referencia lógica |
| `categoryId` | `varchar` | Referencia lógica |
| `nature` | `varchar` | `income` o `expense` |
| `amount` | `int` | CLP, sin decimales |
| `description` | `varchar` | Nullable |
| `transactionDate` | `timestamp` | Fecha real del movimiento (puede diferir de `createdAt`) |
| `createdAt` | `timestamp` | Fecha de ingreso al sistema |

Índices compuestos:
```
@Index('idx_tx_user_date',            ['userId', 'transactionDate'])
@Index('idx_tx_account_date',         ['accountId', 'transactionDate'])
@Index('idx_tx_user_cat_nature_date', ['userId', 'categoryId', 'nature', 'transactionDate'])
```
El tercero cubre el `sumExpenseAmountByUserCategoryAndPeriod` que se ejecuta en cada create de expense.

### `TypeOrmUnitOfWorkImpl`

**Archivo:** `infrastructure/persistence/unit-of-work.impl.ts`

Implementación del `IUnitOfWork`. Scope: `REQUEST` — NestJS crea una instancia nueva por request, lo que garantiza que cada request tiene su propio `QueryRunner`.

Internamente define tres clases privadas (`ScopedTransactionRepository`, `ScopedAccountRepository`, `ScopedBudgetRepository`) que usan el `manager` del `QueryRunner` activo. Solo se construyen después de `begin()`.

### `TransactionMapper`

`toDomain(orm)` — usa `TransactionNature.reconstitute()` y `Amount.reconstitute()` (no re-valida datos ya persistidos). `Transaction.reconstitute()` para preservar timestamps.

### Rutas

| Método | Ruta | Use case | HTTP |
|--------|------|----------|------|
| POST | `/transactions` | `CreateTransactionUseCase` | 201 |
| GET | `/transactions` | `GetTransactionsByUserIdUseCase` | 200 |
| GET | `/transactions/account/:accountId` | `GetTransactionsByAccountIdUseCase` | 200 |
| GET | `/transactions/:id` | `GetTransactionByIdUseCase` | 200 |
| DELETE | `/transactions/:id` | `DeleteTransactionUseCase` | 204 |

Mapeo de excepciones:

| Excepción | HTTP |
|-----------|------|
| `TransactionNotFoundException` | 404 |
| `AccountNotFoundException` | 404 |
| `CategoryNotFoundException` | 404 |
| `IncompatibleCategoryNatureException` | 422 |
| `BudgetRequiredForExpenseTransactionException` | 422 |
| `BudgetLimitExceededException` | 422 |
| `InsufficientFundsException` | 422 |
| `CannotDeleteTransactionException` | 409 |
| `ResourceOwnershipException` | 403 |

---

## Wiring — `TransactionsModule`

Imports: `AccountsModule`, `BudgetsModule` (con `forwardRef` por el ciclo), `CategoriesModule`.  
Exports: `IExpenseChecker` (implementación usada por `BudgetsModule` para validar delete de budget).

---

## Race conditions resueltas (histórico — abril 2026)

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

---

## Decisión arquitectónica — locks en repos escopados

**Decisión:** los locks pesimistas viven hardcodeados en los métodos de los `ScopedXRepository` dentro de `unit-of-work.impl.ts`. **No** se exponen como parámetro opcional ni como método declarativo (`findByIdForUpdate`) en las interfaces de dominio.

**Razones:**
1. Las clases `ScopedXRepository` son privadas al archivo. Solo el UoW las construye y solo se usan dentro de un `QueryRunner` activo. En ese contexto, leer por id implica intención de mutar — no existe caso legítimo de leer sin lock.
2. Las interfaces de dominio (`IAccountRepository`, `IBudgetRepository`) no se contaminan con conceptos SQL. Quedan limpias para el resto del sistema.
3. No requiere crear interfaces escopadas paralelas (`IScopedAccountRepository extends IAccountRepository`) ni modificar `IUnitOfWork` para retornar tipos especializados. Cambio mínimo, máxima cobertura.

**Trade-off aceptado:** se pierde la flexibilidad de hacer una lectura sin lock dentro de una transacción. En este dominio no hay caso de uso para eso — las lecturas no-mutantes (validación, listado) usan los repos globales fuera del UoW.

---

## Conceptos de aislamiento relevantes

**Regla operativa:** el budget row es el **gate de serialización** del invariante "Σ expenses + nuevo expense ≤ budget.limit". Toda la decisión debe construirse con datos leídos **después** de adquirir `SELECT budget FOR UPDATE` y antes del `COMMIT` del UoW — ese es el período crítico. El gate funciona porque la fila del budget siempre existe (unique constraint sobre `(user, category, month, year)` + fail-fast pre-UoW) y todos los flujos que mutan el período (`CreateTransaction`, `UpdateBudgetLimit`, `DeleteBudget`) pasan por él.

`sumExpenseAmountByUserCategoryAndPeriod` (versión scoped en el UoW) **no** toma `FOR UPDATE`. No haría falta: un `FOR UPDATE` sobre `WHERE` por rango solo bloquea las filas existentes que matchean, no previene inserts concurrentes en el rango (phantoms). El único lock confiable es el del budget. Las versiones equivalentes en `ScopedExpenseChecker` (`hasExpensesInPeriod`, `sumExpenseAmountInPeriod`) sí mantienen el `FOR UPDATE`, pero los consumen `UpdateBudgetLimitUseCase` y `DeleteBudgetUseCase` que ya tomaron el lock del budget antes — son redundantes pero defensivas; el `setLock` ahí no se removió porque su contención es despreciable y refuerza el invariante a nivel de repo.

El default de Postgres es `READ COMMITTED`. Dentro de la misma transacción, dos lecturas del mismo row pueden ver valores distintos si otro commit ocurrió entre medio ("non-repeatable reads"). `SERIALIZABLE` detectaría el conflicto en el commit y abortaría con `40001` — requeriría retry en la aplicación.

---

## Recursos

- 📚 **DDIA** cap. 7 "Transactions" — lost update (§7.1), write skew (§7.2)
- 📄 postgresql.org/docs → "Explicit Locking"
- 📄 Use-The-Index-Luke.com — para entender los índices compuestos
