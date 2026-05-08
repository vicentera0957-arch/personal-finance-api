# Módulo `budgets` — Referencia actual

## Concepto

Un **budget** es un límite de gasto mensual: "Comida, abril 2026, máximo $200.000". La app previene que el usuario supere el límite al crear transacciones de gasto.

Campos clave:

- `(userId, categoryId, month, year)` — 4-tupla única enforced a nivel DB
- `limit` — VO `AmountLimit`, entero positivo

---

## Dominio

### Value object `AmountLimit`

**Archivo:** `domain/amountlimit.vo.ts`

Entero positivo que representa el límite de gasto. Validaciones: finito, entero, mayor que cero.

### Entidad `Budget`

Constructor privado. Dos factory methods (`create`, `reconstitute`).

Propiedades: `id`, `userId`, `categoryId`, `month`, `year`, `limit` (`AmountLimit`), `createdAt`, `updatedAt`.

Método de negocio: `updateLimit(newLimit: AmountLimit)` — reemplaza el límite.

### Invariantes

- **R3** — un budget es único por `(userId, categoryId, month, year)`. Enforced con `@Unique` en `BudgetOrmEntity` + migración `1745366400000-AddBudgetUniqueConstraint.ts`.
- **R4** — la categoría del budget debe tener `nature === 'expense'` AND `isBudgetable === true`. Validado en `CreateBudgetUseCase`.
- **R8** (cruzada con transactions) — una transaction de expense requiere un budget para el período y no puede exceder su `limit`. Validado en `CreateTransactionUseCase`.
- Un budget no puede eliminarse si existen transactions de gasto en su período. Enforced vía `IExpenseChecker` port.

### Excepciones de dominio

| Excepción                                      | HTTP |
| ---------------------------------------------- | ---- |
| `BudgetNotFoundException`                      | 404  |
| `ResourceOwnershipException` (shared)          | 403  |
| `BudgetAlreadyExistsException`                 | 409  |
| `BudgetLimitExceededException`                 | 422  |
| `BudgetLimitBelowSpentException`               | 409  |
| `BudgetRequiredForExpenseTransactionException` | 422  |
| `CategoryNotBudgetableForBudgetException`      | 422  |
| `BudgetHasTransactionsInPeriodException`       | 409  |

### Puerto `IExpenseChecker`

**Archivo:** `domain/repository/expense-checker.port.ts`

Definido aquí (consumer owns the port). Implementado en `transactions/infrastructure/persistence/expense-checker.implement.ts`. Exportado por `TransactionsModule`.

Método: `hasExpenseTransactionsInPeriod(userId, categoryId, month, year): Promise<boolean>`

---

## Capa application

| Use case                               | Flujo                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `CreateBudgetUseCase`                  | Valida categoría (expense + budgetable) → persiste → `catch 23505` → `BudgetAlreadyExistsException` |
| `GetBudgetByIdUseCase`                 | Busca → valida ownership → lanza `BudgetNotFoundException`                                          |
| `GetBudgetsByUserIdUseCase`            | Filtra por userId (y opcionalmente month/year)                                                      |
| `GetBudgetByUserCategoryPeriodUseCase` | Búsqueda interna para `CreateTransactionUseCase`                                                    |
| `UpdateBudgetLimitUseCase`             | Abre UoW → `findById` budget (FOR UPDATE) → valida ownership → suma expenses del periodo (FOR UPDATE) → si `nuevo limit < spent` lanza `BudgetLimitBelowSpentException` (409) → commit |
| `DeleteBudgetUseCase`                  | Abre UoW → `findById` budget (FOR UPDATE) → valida ownership → `hasExpensesInPeriod` (FOR UPDATE) → elimina si no hay expenses                                       |

---

## Capa infrastructure

### `BudgetOrmEntity`

| Columna                   | Tipo        | Notas             |
| ------------------------- | ----------- | ----------------- |
| `id`                      | `uuid`      | PK                |
| `userId`                  | `varchar`   |                   |
| `categoryId`              | `varchar`   |                   |
| `month`                   | `int`       | 1-12              |
| `year`                    | `int`       |                   |
| `limit`                   | `int`       | CLP               |
| `createdAt` / `updatedAt` | `timestamp` | `@Column` simples |

`@Unique(['userId', 'categoryId', 'month', 'year'])` — constraint en la entidad.

### `BudgetRepositoryImpl`

`save()` atrapa `QueryFailedError` con `code === '23505'` → lanza `BudgetAlreadyExistsException`. Esto cierra la race condition de "check-then-insert" a nivel DB.

### Rutas

| Método | Ruta                 | Use case                    | HTTP |
| ------ | -------------------- | --------------------------- | ---- |
| POST   | `/budgets`           | `CreateBudgetUseCase`       | 201  |
| GET    | `/budgets`           | `GetBudgetsByUserIdUseCase` | 200  |
| GET    | `/budgets/:id`       | `GetBudgetByIdUseCase`      | 200  |
| PATCH  | `/budgets/:id/limit` | `UpdateBudgetLimitUseCase`  | 200  |
| DELETE | `/budgets/:id`       | `DeleteBudgetUseCase`       | 204  |

---

## Wiring — `BudgetsModule`

Imports `TransactionsModule` (con `forwardRef`) para obtener `IExpenseChecker`.  
Exports: `GetBudgetByUserCategoryPeriodUseCase` — consumido por `CreateTransactionUseCase`.

---

## Dependency inversion: ciclo `budgets ↔ transactions`

Problema: `transactions` necesita `budgets` para validar R8. `budgets` necesita saber si hay transactions para validar el delete. Sin cuidado, ciclo `budgets → transactions → budgets`.

Solución "port owned by consumer":

```
budgets/domain/repository/expense-checker.port.ts   ← define el puerto
transactions/infrastructure/persistence/expense-checker.implement.ts  ← implementa
transactions.module.ts: exports IExpenseChecker
budgets.module.ts:      imports forwardRef(() => TransactionsModule)
```

El `forwardRef()` es un artefacto del DI graph de NestJS. La dirección de dependencia en el DOMINIO es limpia: `transactions` depende de `budgets` (para el budget lookup); `budgets` define el port que `transactions` implementa.

---

## Estado de los races

### ✅ Race de "check-then-insert" en CreateBudget — CERRADA

Estado previo: `CreateBudgetUseCase` hacía check + insert sin garantía de atomicidad.  
Estado actual: `@Unique` en ORM + migración `1745366400000` + `catch 23505` en `BudgetRepositoryImpl.save()` → retorna 409 en vez de 500.

### ⚠️ Bug A — Write skew en UpdateBudgetLimit vs CreateTransaction — RESUELTO

**Escenario:**

1. User tiene budget limit=$100, ha gastado $80.
2. `PATCH /budgets/X/limit` → abre UoW, lee budget con `ScopedBudgetRepository.findById` (**sin lock**), baja el límite a $60, commit.
3. Simultáneamente: `POST /transactions` expense $20 → lee el budget fuera del UoW (usa `getBudgetByUserCategoryPeriodUseCase` global, línea 111 de `create-transaction.use-case.ts`) → ve limit=$100 → $80+$20=100 ≤ 100 → inserta.
4. Resultado: gastó $100 con limit=$60. R8 violada.

**Dos problemas independientes que se combinan:**

- `ScopedBudgetRepository.findById` (`unit-of-work.impl.ts:148`) no toma `FOR UPDATE`
- La segunda lectura del budget en `create-transaction.use-case.ts:111` usa el use case global (no el repo escopado) → sale de la transacción PG

**Fix completo:**

1. Mover la segunda lectura del budget en `CreateTransactionUseCase` a `uow.getBudgetRepository().findByUserIdAndCategoryIdAndPeriod(...)`.
2. Agregar `setLock('pessimistic_write')` en `ScopedBudgetRepository.findById`.

---

## Recursos

- 📚 DDIA §7.2 "Write Skew and Phantoms"
- 📄 postgresql.org/docs → "Transaction Isolation"
- 📄 SOLID "D" — Dependency Inversion Principle
