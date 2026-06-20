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

### Puerto `ITransactionUnitOfWork`

**Archivo:** `domain/ITransactionUnitOfWork.ts`

Clase abstracta que **extiende `IUnitOfWork`** (`shared/domain`). El contrato de ciclo de vida (`begin`, `commit`, `rollback`, `release`, `isActive`) es transversal, se hereda de esa abstracción y se documenta allá — **no se redocumenta aquí**.

Lo que este puerto **añade** son los getters de los repositorios que `CreateTransactionUseCase` y `DeleteTransactionUseCase` necesitan para coordinar escrituras sobre los tres aggregates dentro de una sola transacción:

- `getTransactionRepository()` → `ITransactionRepository` escopado
- `getAccountRepository()` → `IAccountRepository` escopado
- `getBudgetRepository()` → `IBudgetRepository` escopado

Los tres repos escopados comparten el `EntityManager` del `QueryRunner` activo, así que toda lectura/escritura corre en la misma transacción de PostgreSQL. Por construcción (solo se obtienen vía el UoW, ya dentro de una tx abierta) sus lecturas por id toman `FOR UPDATE` — ver la sección *Decisión arquitectónica — locks en repos escopados* más abajo.

> El puerto base `IUnitOfWork` no se documenta en este módulo: vive en `shared/domain` y lo consumen también `IBudgetUnitOfWork`, `IAccountUnitOfWork` e `IAuthUnitOfWork`. Documentar su lifecycle aquí sería duplicar el contrato de la abstracción.

---

## Capa application

### `CreateTransactionUseCase`

**Flujo pre-transacción (fuera del UoW):**
1. Crea VOs `TransactionNature` y `Amount`
2. Valida que la cuenta existe y pertenece al usuario (`GetAccountByIdUseCase`)
3. Valida que la categoría existe, pertenece al usuario, y su naturaleza coincide con la transacción (R7)
4. Si es expense: valida que existe un budget para el período (falla rápido sin abrir la transacción). La categoría debe ser `expense`; la "budgetabilidad" se **deriva de `nature`**, no de un flag `isBudgetable` (ese flag fue eliminado).

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

> El **patrón** (por qué una sola impl satisface varios puertos, por qué los puertos son `abstract class`, por qué se cuentan por *operación atómica* y no por módulo) vive en [shared/domain/uow-decision.md](../../shared/domain/uow-decision.md) y en CLAUDE.md. Esta sección documenta solo la **mecánica concreta** de esta clase — para no duplicar el "por qué" y que vuelva a derivar.

Una sola clase concreta que satisface **tres** puertos de módulo: `ITransactionUnitOfWork` (lo extiende), `IBudgetUnitOfWork` e `IAccountUnitOfWork` (los implementa). Los tres tokens resuelven a la **misma** instancia vía `useExisting` en el wiring — un alias, no copias. Scope: `REQUEST` — NestJS crea una instancia nueva por request, así que cada request tiene su propio `QueryRunner` aislado.

#### Estado y ciclo de vida

La clase mantiene un solo campo mutable: `queryRunner: QueryRunner | null` (arranca en `null`). Los cinco métodos heredados de `IUnitOfWork` operan sobre él:

| Método | Qué hace |
|--------|----------|
| `begin()` | `dataSource.createQueryRunner()` → `connect()` → `startTransaction()`. A partir de aquí hay una conexión dedicada con una transacción de PG abierta. |
| `commit()` | `queryRunner?.commitTransaction()` — confirma todo lo escrito en la tx. |
| `rollback()` | `queryRunner?.rollbackTransaction()` — descarta todo. |
| `release()` | `queryRunner?.release()` y vuelve `queryRunner` a `null` — **devuelve la conexión al pool**. Va siempre en el `finally` del use case; omitirlo filtra conexiones. |
| `isActive()` | `queryRunner !== null` — true entre `begin()` y `release()`. |

El optional-chaining (`?.`) en commit/rollback/release hace que llamarlos sin una tx abierta sea no-op en vez de un crash.

#### Los cuatro recursos escopados

Cuatro getters construyen los repos escopados, todos sobre `this.queryRunner!.manager` (el `EntityManager` del runner activo):

- `getTransactionRepository()` → `ScopedTransactionRepository`
- `getAccountRepository()` → `ScopedAccountRepository`
- `getBudgetRepository()` → `ScopedBudgetRepository`
- `getScopedExpenseChecker()` → `ScopedExpenseChecker` (satisface el puerto `IExpenseChecker` de `budgets`, patrón *port owned by consumer*)

Las cuatro clases son **privadas al archivo** (no exportadas). La única forma de obtenerlas es a través del UoW, y eso solo tiene sentido después de `begin()`. Esa garantía es la que justifica el `!` (non-null assertion) sobre `queryRunner` en los getters: por contrato nunca se llaman con el runner en `null`. Como todas comparten el mismo `manager`, toda lectura y escritura cae en la misma transacción de PostgreSQL.

#### Locks por construcción

Por vivir siempre dentro de una tx abierta, los `findById` de los repos escopados toman `FOR UPDATE` (`lock: { mode: 'pessimistic_write' }`) sin parámetro: leer una fila por id aquí implica intención de mutar. Los métodos agregados (`SUM`/`COUNT`) **no** toman lock — Postgres lo prohíbe sobre agregados, y la serialización se la da el `FOR UPDATE` que el caller toma antes sobre la fila del budget. Ver el mapa completo en [CLAUDE.md → Locking & serialization map](../../../CLAUDE.md) y la justificación en *Decisión arquitectónica — locks en repos escopados* más abajo.

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
| `IncompatibleCategoryNatureException` | 400 |
| `BudgetRequiredForExpenseTransactionException` | 409 |
| `BudgetLimitExceededException` | 422 |
| `InsufficientFundsException` | 422 |
| `CannotDeleteTransactionException` | 409 |
| `ResourceOwnershipException` | 403 |

---

## Wiring — `TransactionsModule`

Imports: `AccountsModule`, `BudgetsModule` (con `forwardRef` por el ciclo), `CategoriesModule`.  
Exports: `IExpenseChecker` (implementación usada por `BudgetsModule` para validar delete de budget).

---

## Race conditions resueltas (histórico)

Los bugs de concurrencia ya cerrados **propios de este módulo** (Bug A, Bug A.2, Bug B) y su análisis completo se movieron a [notes-history.md](./notes-history.md).

Los races que **cruzan módulos** — Race 1 (`DELETE /budgets/:id` vs `POST /transactions`) y Race 2 (mutaciones de cuenta vs `POST /transactions`) — están documentados centralmente en [docs/history/race-conditions-fix-2026-05.md](../../../docs/history/race-conditions-fix-2026-05.md).

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

`sumExpenseAmountByUserCategoryAndPeriod` (versión scoped en el UoW) **no** toma `FOR UPDATE`. No haría falta: un `FOR UPDATE` sobre `WHERE` por rango solo bloquea las filas existentes que matchean, no previene inserts concurrentes en el rango (phantoms). El único lock confiable es el del budget. Las versiones equivalentes en `ScopedExpenseChecker` (`hasExpensesInPeriod`, `sumExpenseAmountInPeriod`) **tampoco** toman `FOR UPDATE` — por la misma razón, y además Postgres prohíbe el lock pesimista sobre agregados (`COUNT`/`SUM`). Su consistencia la garantiza el lock sobre la fila del budget que `UpdateBudgetLimitUseCase` y `DeleteBudgetUseCase` adquieren **antes** de invocarlas.

El default de Postgres es `READ COMMITTED`. Dentro de la misma transacción, dos lecturas del mismo row pueden ver valores distintos si otro commit ocurrió entre medio ("non-repeatable reads"). `SERIALIZABLE` detectaría el conflicto en el commit y abortaría con `40001` — requeriría retry en la aplicación.

---

## Recursos

- 📚 **DDIA** cap. 7 "Transactions" — lost update (§7.1), write skew (§7.2)
- 📄 postgresql.org/docs → "Explicit Locking"
- 📄 Use-The-Index-Luke.com — para entender los índices compuestos
