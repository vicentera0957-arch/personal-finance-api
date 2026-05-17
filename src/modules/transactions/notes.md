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
3. `budgetRepo.findByUserIdAndCategoryIdAndPeriod(...)` (repo escopado, lock pesimista implícito) — releé el budget bajo `FOR UPDATE` para verificar el límite vigente al momento del COMMIT
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

`sumExpenseAmountByUserCategoryAndPeriod` toma `pessimistic_write` sobre las filas de transacciones del período. Antes era el único lock en juego — insuficiente porque no bloqueaba el budget ni la cuenta. Hoy actúa como capa adicional sobre las transacciones del período; el budget y el account ya tienen sus propios locks vía los scoped repos.

**Punto importante:** el budget actúa como **gate de serialización del invariante** "suma de transactions ≤ limit". Lockear el budget al momento de insertar una transaction bloquea cualquier modificación concurrente del limit, y viceversa. El lock se sostiene desde el `SELECT FOR UPDATE` hasta el `COMMIT` del UoW — ese es exactamente el período crítico.

El default de Postgres es `READ COMMITTED`. Dentro de la misma transacción, dos lecturas del mismo row pueden ver valores distintos si otro commit ocurrió entre medio ("non-repeatable reads"). `SERIALIZABLE` detectaría el conflicto en el commit y abortaría con `40001` — requeriría retry en la aplicación.

---

## Recursos

- 📚 **DDIA** cap. 7 "Transactions" — lost update (§7.1), write skew (§7.2)
- 📄 postgresql.org/docs → "Explicit Locking"
- 📄 Use-The-Index-Luke.com — para entender los índices compuestos
