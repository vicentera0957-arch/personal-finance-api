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
2. `txRepo.sumExpenseAmountByUserCategoryAndPeriod(...)` con `setLock('pessimistic_write')` — lock en las filas de gasto del período
3. Lee el budget nuevamente (⚠️ **Bug A** — ver abajo) para verificar el límite
4. `UpdateAccountBalanceUseCase(acctRepo).execute(...)` — actualiza balance usando el repositorio escopado
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

## Bugs activos — leer antes de tocar este módulo

### Bug A — Write skew en budget limit

**Escenario:** User tiene budget limit=$100, ha gastado $80.
1. `PATCH /budgets/X/limit` → `UpdateBudgetLimitUseCase` abre UoW, lee budget sin lock, cambia limit a $60, hace commit.
2. Simultáneamente: `POST /transactions` expense $20 → lee budget FUERA del UoW (línea 111 usa `getBudgetByUserCategoryPeriodUseCase` global, no el repo escopado) → ve limit=$100 → $80+$20=100 ≤ 100 → inserta.
3. Resultado: el user gastó $100 pero el limit es $60. R8 violada.

**Archivo exacto:** `create-transaction.use-case.ts:111` y `unit-of-work.impl.ts:148-150`.

**Fix:** Mover la segunda lectura del budget dentro del UoW usando `uow.getBudgetRepository().findByUserIdAndCategoryIdAndPeriod(...)` en lugar del use case global. Y agregar `FOR UPDATE` a `ScopedBudgetRepository.findById`.

### Bug B — Lost update en balance de cuenta

**Escenario:** Dos requests concurrentes `POST /transactions` sobre la misma cuenta.
1. TX1 lee `account.balance = $1000` (sin lock)
2. TX2 lee `account.balance = $1000` (sin lock)
3. TX1 calcula $1000 + $500 = $1500, escribe
4. TX2 calcula $1000 - $300 = $700, escribe → **los $500 de TX1 se perdieron**

**Archivo exacto:** `unit-of-work.impl.ts:119-121` — `ScopedAccountRepository.findById` usa `manager.findOne` sin lock.

**Fix:** Añadir `SELECT ... FOR UPDATE` al `findById` del `ScopedAccountRepository`.

---

## Conceptos de aislamiento relevantes

`sumExpenseAmountByUserCategoryAndPeriod` toma `pessimistic_write` sobre las filas de transacciones del período. Esto bloquea inserciones concurrentes en las mismas filas. Pero no bloquea el budget ni la cuenta — de ahí los bugs A y B.

El default de Postgres es `READ COMMITTED`. Dentro de la misma transacción, dos lecturas del mismo row pueden ver valores distintos si otro commit ocurrió entre medio ("non-repeatable reads"). `SERIALIZABLE` detectaría el conflicto en el commit y abortaría con `40001` — requeriría retry en la aplicación.

---

## Recursos

- 📚 **DDIA** cap. 7 "Transactions" — lost update (§7.1), write skew (§7.2)
- 📄 postgresql.org/docs → "Explicit Locking"
- 📄 Use-The-Index-Luke.com — para entender los índices compuestos
