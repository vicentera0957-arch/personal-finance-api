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
- **R4** — la categoría del budget debe tener `nature === 'expense'`. La budgetabilidad se **deriva de `nature`** (no existe flag `isBudgetable`). Validado en `CreateBudgetUseCase` → `BudgetCategoryMustBeExpenseException`.
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
| `BudgetRequiredForExpenseTransactionException` | 409  |
| `BudgetCategoryMustBeExpenseException`         | 409  |
| `BudgetHasTransactionsInPeriodException`       | 409  |

### Puerto `IExpenseChecker`

**Archivo:** `domain/repository/expense-checker.port.ts`

Definido aquí (consumer owns the port). Implementado en `transactions/infrastructure/persistence/expense-checker.implement.ts`. Exportado por `TransactionsModule`.

Métodos: `hasExpensesInPeriod(userId, categoryId, month, year): Promise<boolean>` y `sumExpenseAmountInPeriod(...): Promise<number>`. **Ninguno toma `FOR UPDATE`** (Postgres prohíbe lock pesimista sobre agregados `COUNT`/`SUM`); la serialización la da el lock sobre la fila del budget que el consumidor (`DeleteBudget` / `UpdateBudgetLimit`) adquiere antes.

---

## Capa application

| Use case                               | Flujo                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `CreateBudgetUseCase`                  | Valida categoría (`nature === 'expense'`) → persiste → `catch 23505` → `BudgetAlreadyExistsException` |
| `GetBudgetByIdUseCase`                 | Busca → valida ownership → lanza `BudgetNotFoundException`                                          |
| `GetBudgetsByUserIdUseCase`            | Filtra por userId (y opcionalmente month/year)                                                      |
| `GetBudgetByUserCategoryPeriodUseCase` | Búsqueda interna para `CreateTransactionUseCase`                                                    |
| `UpdateBudgetLimitUseCase`             | Abre UoW → `findById` budget (FOR UPDATE) → valida ownership → suma expenses del periodo (sin lock propio; serializa el lock del budget) → si `nuevo limit < spent` lanza `BudgetLimitBelowSpentException` (409) → commit |
| `DeleteBudgetUseCase`                  | Abre UoW → `findById` budget (FOR UPDATE) → valida ownership → `hasExpensesInPeriod` (sin lock propio; serializa el lock del budget) → elimina si no hay expenses |

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

## Estado de los races (histórico)

Movido a [notes-history.md](./notes-history.md): la race de "check-then-insert" en `CreateBudget` (cerrada con `@Unique` + `catch 23505`) y el write-skew **Bug A**. Los races que cruzan módulos (Race 1: `DELETE /budgets/:id` vs `POST /transactions`) están en [docs/race-conditions-fix-2026-05.md](../../../docs/race-conditions-fix-2026-05.md).

---

## Recursos

- 📚 DDIA §7.2 "Write Skew and Phantoms"
- 📄 postgresql.org/docs → "Transaction Isolation"
- 📄 SOLID "D" — Dependency Inversion Principle
