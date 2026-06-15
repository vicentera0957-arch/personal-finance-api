# Módulo `accounts` — Referencia actual

## Dominio

### Value object `Balance`

**Archivo:** `domain/value-objects/balance.vo.ts`

Monto monetario en CLP (sin decimales). Inmutable.

Métodos:
- `Balance.create(amount)` — valida finito, no negativo, sin decimales
- `Balance.reconstitute(value)` — reconstruye desde persistencia sin re-validar (el mapper SIEMPRE usa este)
- `Balance.zero()` — factory para balance cero
- `add(other)` / `subtract(other)` — aritmética inmutable; `subtract` lanza `InsufficientFundsException` si el resultado sería negativo
- `getValue()`, `equals()`, `greaterThan()`, `isZero()`

CLP no tiene centavos — almacenar en centavos solo añade conversión sin beneficio. Si en el futuro se soportan otras monedas habrá que migrar la columna a `decimal(15,2)`.

La regla "un balance no puede ser negativo" vive en el VO porque es la única forma de garantizar que sea imposible construir un `Balance` inválido desde cualquier punto del sistema.

### Value object `AccountType`

**Archivo:** `domain/value-objects/type.vo.ts`

Lista cerrada normalizada a minúsculas: `ahorro`, `corriente`, `vista`, `ruta`, `otros`.

### Entidad `Account`

**Archivo:** `domain/entities/account.entity.ts`

Constructor privado. Dos factory methods:
- `Account.create(props)` — `currentBalance` arranca igual a `initialBalance`; `isArchived = false`
- `Account.reconstitute(props)` — acepta `currentBalance` independiente del inicial

Métodos de negocio:

| Método | Comportamiento | Bloqueado si archivada |
|--------|---------------|----------------------|
| `inflow(amount)` | Suma al balance | ✅ `CannotOperateOnArchivedAccountException` |
| `outflow(amount)` | Resta al balance (delega en `Balance.subtract`) | ✅ |
| `rename(name)` | Actualiza nombre | ✅ |
| `archive()` | Archiva; lanza error si ya archivada | — |
| `unarchive()` | Desarchiva; lanza error si no archivada | — |
| `hasSufficientFunds(amount)` | Solo lectura | — |

**Invariante:** una cuenta archivada es inmutable. El usuario debe llamar `unarchive()` explícitamente antes de volver a operar. `archive()` y `unarchive()` no son idempotentes — lanzan excepción si el estado ya es el pedido.

### Excepciones de dominio

**Archivo:** `domain/exceptions/account.exceptions.ts`

Base: `AccountException extends Error`. El controlador es el único lugar donde se mapean a HTTP.

| Excepción | HTTP |
|-----------|------|
| `AccountNotFoundException` | 404 |
| `AccountAlreadyArchivedDomainException` | 409 |
| `AccountNotArchivedDomainException` | 409 |
| `CannotOperateOnArchivedAccountException` | 409 |
| `ZeroAmountInflowException` | 400 |
| `ZeroAmountOutflowException` | 400 |
| `InvalidAccountNameException` | 400 |
| `InsufficientFundsException` | 422 |
| `InvalidBalanceException` | 400 |
| `NoTypeProvidedException` | 400 |
| `InvalidAccountTypeException` | 400 |

### Puerto `IAccountRepository`

Clase abstracta. Métodos: `findById`, `findByUserId`, `save`, `delete`.

---

## Capa application

| Use case | Flujo |
|----------|-------|
| `CreateAccountUseCase` | Crea VOs → crea entidad → persiste |
| `GetAccountByIdUseCase` | Busca por id → valida ownership (`requestUserId`) → lanza `AccountNotFoundException` si no existe |
| `GetAccountsByUserIdUseCase` | Retorna array (vacío es válido) |
| `RenameAccountUseCase` | Abre `IAccountUnitOfWork` → `findById` (FOR UPDATE) → ownership inline → `account.rename()` → persiste |
| `ArchiveAccountUseCase` | Abre `IAccountUnitOfWork` → `findById` (FOR UPDATE) → ownership inline → `account.archive()` → persiste |
| `UnarchiveAccountUseCase` | Abre `IAccountUnitOfWork` → `findById` (FOR UPDATE) → ownership inline → `account.unarchive()` → persiste |
| `DeleteAccountUseCase` | Delega a `GetAccountByIdUseCase` (existencia + ownership) → `repo.delete()` — sin UoW (no muta balance) |

> **Por qué Rename/Archive/Unarchive usan UoW y Delete no:** los tres primeros compiten por el lock de la fila de la cuenta contra `CreateTransaction`/`DeleteTransaction` (ver Race 2). `Delete` no muta balance, así que no necesita serializarse con las mutaciones financieras.
| `UpdateAccountBalanceUseCase` | `repo.findById()` → `account.inflow()` o `account.outflow()` → `repo.save()` |

### `UpdateAccountBalanceUseCase` — consumido por `transactions`

**Archivo:** `application/use-cases/update-account-balance.use-case.ts`

Este use case ES consumido por `CreateTransactionUseCase` y `DeleteTransactionUseCase`. El módulo `transactions` construye una instancia directamente inyectando el **repositorio escopado del UoW**:

```typescript
// create-transaction.use-case.ts (dentro del bloque UoW)
const acctRepo = this.uow.getAccountRepository(); // ScopedAccountRepository
const updateBalance = new UpdateAccountBalanceUseCase(acctRepo);
await updateBalance.execute(command.accountId, amount.getValue(), 'inflow' | 'outflow');
```

Al usar el repositorio escopado, la actualización del balance corre dentro de la misma transacción de PostgreSQL que el `txRepo.save(transaction)`. Esto garantiza atomicidad: si el save de la transacción falla, el balance tampoco se actualiza.

✅ **Bug B (lost update de balance) — CERRADO.** `ScopedAccountRepository.findById` toma `FOR UPDATE`, así que dos transacciones concurrentes sobre la misma cuenta se serializan: la segunda espera el COMMIT de la primera y lee el balance vigente. Post-mortem completo en [transactions/notes-history.md](../../transactions/notes-history.md). La competencia entre mutaciones de cuenta y transacciones (Race 2) está en [docs/race-conditions-fix-2026-05.md](../../../docs/race-conditions-fix-2026-05.md).

---

## Capa infrastructure

### `AccountOrmEntity`

**Archivo:** `infrastructure/persistance/account.orm.entity.ts`

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | `uuid` | PK, generado con `randomUUID()` |
| `userId` | `varchar` | Referencia lógica |
| `name` | `varchar` | |
| `type` | `varchar` | String del VO `AccountType` |
| `initialBalance` | `int` | CLP |
| `currentBalance` | `int` | CLP |
| `isArchived` | `boolean` | Default `false` |
| `created_at` | `timestamp` | `@Column` simple — el dominio controla el valor |
| `updated_at` | `timestamp` | `@Column` simple — el dominio controla el valor |

Índice: `@Index('idx_account_user', ['userId'])` — el listado por usuario es hot-path.

**Por qué `@Column` simple en lugar de `@CreateDateColumn`:** TypeORM con `@CreateDateColumn`/`@UpdateDateColumn` sobreescribe los valores en cada `save()`, ignorando lo que el dominio setea. Con `@Column` simple, la entidad de dominio es la única fuente de verdad para las fechas.

### `AccountMapper`

`toDomain(orm)` — usa `Balance.reconstitute()` y `AccountType.reconstitute()` (no re-valida datos persistidos). `Account.reconstitute()` para preservar timestamps.  
`toOrm(domain)` — extrae valores con getters.

### Rutas

| Método | Ruta | Use case | HTTP |
|--------|------|----------|------|
| POST | `/accounts` | `CreateAccountUseCase` | 201 |
| GET | `/accounts` | `GetAccountsByUserIdUseCase` | 200 |
| GET | `/accounts/:id` | `GetAccountByIdUseCase` | 200 |
| PATCH | `/accounts/:id/name` | `RenameAccountUseCase` | 200 |
| PATCH | `/accounts/:id/archive` | `ArchiveAccountUseCase` | 200 |
| PATCH | `/accounts/:id/unarchive` | `UnarchiveAccountUseCase` | 200 |
| DELETE | `/accounts/:id` | `DeleteAccountUseCase` | 204 |

---

## Wiring — `AccountsModule`

Exports:
- `GetAccountByIdUseCase` — consumido por `budgets` y `transactions` (ownership check cross-module)
- `GetAccountsByUserIdUseCase` — consumido por `transactions`
- `UpdateAccountBalanceUseCase` — consumido por `transactions`
- `IAccountRepository` — consumido por `transactions` para el UoW scoped repo

---

## Extensión futura: transferencias

Para "mover $X de cuenta A a cuenta B":

```
TransferUseCase(fromId, toId, amount):
  uow.begin()
    txRepo.save(tx: outflow from A, transferGroupId)
    txRepo.save(tx: inflow  to B, transferGroupId)
    updateBalance(A, -amount, 'outflow')
    updateBalance(B, +amount, 'inflow')
  uow.commit()
```

Ambas transacciones deben compartir un `transferGroupId` para reconstruir el transfer lógico. El UoW ya existe — la extensión es agregar el campo y el use case.

---

## Recursos

- 📚 DDIA cap. 7 — lost update problem y pessimistic/optimistic locking
- 📄 postgresql.org/docs → "Explicit Locking"
