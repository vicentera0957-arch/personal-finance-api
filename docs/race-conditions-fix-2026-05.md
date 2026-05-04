# Race Conditions Fix — 2026-05

> Cierre de dos races activas identificadas tras el hardening audit de abril 2026.
> **Estado final:** 588/588 tests pasando, cero errores TypeScript nuevos introducidos.

---

## Resumen ejecutivo

Se identificaron y cerraron dos condiciones de carrera en la API de finanzas personales. Ambas comprometían la integridad de datos bajo concurrencia:

| ID | Ruta afectada | Riesgo | Estado |
|----|--------------|--------|--------|
| Race 1 | `DELETE /budgets/:id` vs `POST /transactions` | Gasto huérfano sin budget / 500 en CreateTransaction | ✅ Cerrado |
| Race 2 | `PATCH /accounts/:id/{archive,unarchive,name}` vs `POST /transactions` | Balance sobreescrito (lost update) | ✅ Cerrado |

---

## Race 1 — `DELETE /budgets/:id` vs `POST /transactions`

### Qué pasaba

`DeleteBudgetUseCase` corría completamente fuera de cualquier transacción de base de datos:

```
// ANTES (pseudocódigo del flujo)
1. hasExpensesInPeriod(userId, categoryId, month, year)  ← consulta sin lock
2. // ← ventana de tiempo: CreateTransaction puede insertar aquí
3. budgetRepository.delete(id)                           ← fuera de transacción
```

**Escenario de fallo (TOCTOU — Time Of Check, Time Of Use):**

```
T1 (DeleteBudget)                    T2 (CreateTransaction)
─────────────────────────────────    ────────────────────────────────────
hasExpenses = false ← 0 gastos       BEGIN
                                     SELECT budget FOR UPDATE (ok, no lock en T1)
                                     suma_gastos = 0 ≤ límite → ok
                                     INSERT transaction
                                     UPDATE account balance
                                     COMMIT (gasto insertado)
DELETE budget ← borra el budget
```

Resultado: existe una transacción de gasto en el periodo pero ya no existe el budget. Invariante violada. Además, si `CreateTransaction` hace su re-lectura del budget bajo `FOR UPDATE` y `DeleteBudget` borró el budget entretanto → `budget!.getLimit()` revienta con 500.

### Cómo se cerró

`DeleteBudgetUseCase` ahora corre **dentro de `IBudgetUnitOfWork`**. El `ScopedBudgetRepository.findById` toma `FOR UPDATE`, y el nuevo `getScopedExpenseChecker()` usa el mismo `QueryRunner` (mismo `EntityManager`) con `pessimistic_write` también sobre la consulta de gastos.

**Secuencia serializada post-fix:**

```
T1 (DeleteBudget)                    T2 (CreateTransaction)
─────────────────────────────────    ────────────────────────────────────
BEGIN
SELECT budget FOR UPDATE             ← T2 se bloquea aquí si toca el mismo budget
hasExpenses = false (bajo lock)
DELETE budget
COMMIT
                                     ← T2 desbloquea, lee budget → no existe → falla
                                       (lanza BudgetNotFoundException, 422)
```

O en el orden inverso: T2 entra primero, toma `FOR UPDATE` sobre el budget, T1 espera. T2 commitea. T1 lee, `hasExpenses = true` → lanza `BudgetHasTransactionsInPeriodException` (409).

---

## Race 2 — Mutaciones de cuenta vs `POST /transactions`

### Qué pasaba

`ArchiveAccountUseCase`, `UnarchiveAccountUseCase` y `RenameAccountUseCase` inyectaban el repositorio global `IAccountRepository` directamente — sin transacción, sin `FOR UPDATE`:

```ts
// ANTES
constructor(private readonly accountRepository: IAccountRepository) {}

async execute(dto) {
  const account = await this.accountRepository.findById(dto.id); // sin lock
  account.archive();
  await this.accountRepository.save(account); // UPDATE completo de la fila
}
```

`CreateTransactionUseCase` y `DeleteTransactionUseCase` **sí** usaban `ScopedAccountRepository.findById` que toma `FOR UPDATE`. Pero los use cases de mutación de cuenta no competían por ese lock → podían pisar el balance que `CreateTransaction` acababa de escribir.

**Escenario de lost update:**

```
T1 (CreateTransaction)              T2 (ArchiveAccount)
──────────────────────────────────  ──────────────────────────────────
BEGIN
SELECT account FOR UPDATE
  balance = 1000
  [procesa transacción de gasto]
  balance_nuevo = 800
                                    SELECT account (SIN lock, SIN transacción)
                                      lee balance = 1000  ← valor viejo
UPDATE account SET balance = 800
COMMIT
                                    account.archive()
                                    UPDATE account SET
                                      balance = 1000,     ← PISA el 800
                                      isArchived = true
```

La cuenta termina archivada con balance incorrecto. La transacción financiera existe en DB pero el balance no la refleja. **Integridad de datos comprometida silenciosamente.**

### Cómo se cerró

Los tres use cases ahora inyectan `IAccountUnitOfWork` en lugar del repositorio global. El `ScopedAccountRepository.findById` dentro del UoW toma `FOR UPDATE`, compitiendo por el mismo lock que usa `CreateTransaction`:

```ts
// DESPUÉS
constructor(private readonly uow: IAccountUnitOfWork) {}

async execute(dto) {
  await this.uow.begin();
  try {
    const accountRepo = this.uow.getAccountRepository(); // ScopedAccountRepository
    const account = await accountRepo.findById(dto.id);  // FOR UPDATE
    if (!account) throw new AccountNotFoundException(dto.id);
    if (account.userId !== dto.requestUserId) throw new ResourceOwnershipException(dto.id);
    account.archive();
    const saved = await accountRepo.save(account);       // mismo QueryRunner
    await this.uow.commit();
    return saved;
  } catch (error) {
    await this.uow.rollback();
    throw error;
  } finally {
    await this.uow.release();
  }
}
```

---

## Cambios por archivo

### Nuevos archivos

| Archivo | Qué hace |
|---------|----------|
| [src/modules/accounts/domain/IAccountUnitOfWork.ts](../src/modules/accounts/domain/IAccountUnitOfWork.ts) | Puerto del UoW para el bounded context de cuentas. Extiende `IUnitOfWork` y agrega `getAccountRepository()`. Vive en `accounts/domain` siguiendo el patrón "port owned by consumer". |

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| [src/modules/budgets/domain/IBudgetUnitOfWork.ts](../src/modules/budgets/domain/IBudgetUnitOfWork.ts) | Agrega método abstracto `getScopedExpenseChecker(): IExpenseChecker`. |
| [src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts](../src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts) | 1) Nueva clase privada `ScopedExpenseChecker` con `hasExpensesInPeriod` + `pessimistic_write`. 2) Implementa `IAccountUnitOfWork` (el método `getAccountRepository()` ya existía). 3) Implementa `getScopedExpenseChecker()`. |
| [src/modules/transactions/transactions.module.ts](../src/modules/transactions/transactions.module.ts) | Agrega provider `{ provide: IAccountUnitOfWork, useExisting: TypeOrmUnitOfWorkImpl }`, exporta `IAccountUnitOfWork`, cambia `AccountsModule` por `forwardRef(() => AccountsModule)`. |
| [src/modules/accounts/accounts.module.ts](../src/modules/accounts/accounts.module.ts) | Agrega `forwardRef(() => TransactionsModule)` en imports (para que NestJS resuelva `IAccountUnitOfWork` en los use cases). |
| [src/modules/budgets/application/use-cases/delete-budget.use-case.ts](../src/modules/budgets/application/use-cases/delete-budget.use-case.ts) | Reescrito. Elimina `IBudgetRepository`, `GetBudgetByIdUseCase`, `IExpenseChecker` directo. Ahora solo inyecta `IBudgetUnitOfWork`. Toda la lógica dentro de `begin/try/catch(rollback)/finally(release)`. |
| [src/modules/accounts/application/use-cases/archive-account.use-case.ts](../src/modules/accounts/application/use-cases/archive-account.use-case.ts) | Reescrito. Elimina `IAccountRepository` + `GetAccountByIdUseCase`. Inyecta `IAccountUnitOfWork`. Ownership check inline. |
| [src/modules/accounts/application/use-cases/unarchive-account.use-case.ts](../src/modules/accounts/application/use-cases/unarchive-account.use-case.ts) | Mismo patrón que archive. |
| [src/modules/accounts/application/use-cases/rename-account.use-case.ts](../src/modules/accounts/application/use-cases/rename-account.use-case.ts) | Mismo patrón que archive. |

### Tests actualizados

| Archivo | Cambio |
|---------|--------|
| [src/modules/budgets/application/use-cases/delete-budget.use-case.spec.ts](../src/modules/budgets/application/use-cases/delete-budget.use-case.spec.ts) | Reescrito con `mockUow` que incluye `getScopedExpenseChecker`. 4 tests: delete exitoso, budget con gastos (409), no encontrado (404), acceso denegado (403). |
| [src/modules/accounts/application/use-cases/archive-account.use-case.spec.ts](../src/modules/accounts/application/use-cases/archive-account.use-case.spec.ts) | Reescrito con `makeMockUow`. 4 tests: archive exitoso, ya archivado, no encontrado, ownership denegado. |
| [src/modules/accounts/application/use-cases/unarchive-account.use-case.spec.ts](../src/modules/accounts/application/use-cases/unarchive-account.use-case.spec.ts) | Mismo patrón. |
| [src/modules/accounts/application/use-cases/rename-account.use-case.spec.ts](../src/modules/accounts/application/use-cases/rename-account.use-case.spec.ts) | Mismo patrón. |
| [src/modules/transactions/infrastructure/persistence/\__fakes\__/in-memory-unit-of-work.ts](../src/modules/transactions/infrastructure/persistence/__fakes__/in-memory-unit-of-work.ts) | Implementa `getScopedExpenseChecker()` requerido por el contrato actualizado de `IBudgetUnitOfWork`. Acepta `expenseChecker` opcional en constructor, lanza si no fue provisto. |

---

## Patrón arquitectónico aplicado

### "Port owned by consumer"

El dominio de `accounts` no puede importar infraestructura de `transactions`. Para que `ArchiveAccountUseCase` use el UoW correcto sin violar la separación de capas:

```
accounts/domain/IAccountUnitOfWork.ts     ← define el contrato (no sabe de TypeORM)
         ↑ implementa
transactions/infrastructure/unit-of-work.impl.ts  ← satisface el contrato
         ↓ provee vía useExisting
TransactionsModule → exports: [IAccountUnitOfWork]
         ↓ importa
AccountsModule → forwardRef(() => TransactionsModule)
```

### `useExisting` — instancia única por request

```ts
// TransactionsModule providers
{ provide: TypeOrmUnitOfWorkImpl, useClass: TypeOrmUnitOfWorkImpl, scope: Scope.REQUEST }
{ provide: ITransactionUnitOfWork, useExisting: TypeOrmUnitOfWorkImpl }
{ provide: IBudgetUnitOfWork,      useExisting: TypeOrmUnitOfWorkImpl }
{ provide: IAccountUnitOfWork,     useExisting: TypeOrmUnitOfWorkImpl }
```

`useExisting` garantiza que todos los tokens resuelven a **la misma instancia** de `TypeOrmUnitOfWorkImpl` dentro de un request HTTP. Un `QueryRunner` → una transacción PostgreSQL → atomicidad real.

### Árbol de locks post-fix

| Método | Lock | Propósito |
|--------|------|-----------|
| `ScopedAccountRepository.findById` | `pessimistic_write` | Serializa balance updates (CreateTransaction, DeleteTransaction, Archive, Unarchive, Rename) |
| `ScopedBudgetRepository.findById` | `pessimistic_write` | Serializa UpdateBudgetLimit y DeleteBudget contra CreateTransaction |
| `ScopedBudgetRepository.findByUserIdAndCategoryIdAndPeriod` | `pessimistic_write` | Serializa el check de límite en CreateTransaction |
| `ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod` | `pessimistic_write` | Belt-and-suspenders contra phantom inserts en la suma de gastos |
| `ScopedExpenseChecker.hasExpensesInPeriod` | `pessimistic_write` | Serializa el check de gastos en DeleteBudget |

---

## Dependencia circular `accounts ↔ transactions`

Antes de este fix: `TransactionsModule` importaba `AccountsModule` (para `GetAccountByIdUseCase`). Ahora `AccountsModule` también importa `TransactionsModule` (para `IAccountUnitOfWork`). Solución estándar en NestJS: `forwardRef()` en ambos lados.

```
TransactionsModule: imports: [forwardRef(() => AccountsModule), ...]
AccountsModule:     imports: [forwardRef(() => TransactionsModule), ...]
```

Este patrón ya existía para `budgets ↔ transactions` — se replicó exactamente.

---

## Stats finales

```
Test Suites: 68 passed, 68 total
Tests:       588 passed, 588 total
TypeScript:  0 errores nuevos introducidos
```
