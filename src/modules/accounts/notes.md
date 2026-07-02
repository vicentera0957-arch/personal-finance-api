# `accounts` module — Current reference

## Domain

### `Balance` value object

**File:** `domain/value-objects/balance.vo.ts`

Monetary amount in CLP (no decimals). Immutable.

Methods:
- `Balance.create(amount)` — validates finite, non-negative, no decimals
- `Balance.reconstitute(value)` — rebuilds from persistence without re-validating (the mapper ALWAYS uses this one)
- `Balance.zero()` — factory for a zero balance
- `add(other)` / `subtract(other)` — immutable arithmetic; `subtract` throws `InsufficientFundsException` if the result would be negative
- `getValue()`, `equals()`, `greaterThan()`, `isZero()`

CLP has no cents — storing in cents only adds conversion with no benefit. If other currencies are supported in the future, the column will have to migrate to `decimal(15,2)`.

The rule "a balance cannot be negative" lives in the VO because that is the only way to guarantee it is impossible to construct an invalid `Balance` from anywhere in the system.

### `AccountType` value object

**File:** `domain/value-objects/type.vo.ts`

Closed list normalized to lowercase: `ahorro`, `corriente`, `vista`, `ruta`, `otros`.

### `Account` entity

**File:** `domain/entities/account.entity.ts`

Private constructor. Two factory methods:
- `Account.create(props)` — `currentBalance` starts equal to `initialBalance`; `isArchived = false`
- `Account.reconstitute(props)` — accepts a `currentBalance` independent of the initial one

Business methods:

| Method | Behavior | Blocked if archived |
|--------|---------------|----------------------|
| `inflow(amount)` | Adds to the balance | Yes — `CannotOperateOnArchivedAccountException` |
| `outflow(amount)` | Subtracts from the balance (delegates to `Balance.subtract`) | Yes |
| `rename(name)` | Updates the name | Yes |
| `archive()` | Archives; throws if already archived | — |
| `unarchive()` | Unarchives; throws if not archived | — |
| `hasSufficientFunds(amount)` | Read-only | — |

**Invariant:** an archived account is immutable. The user must call `unarchive()` explicitly before operating again. `archive()` and `unarchive()` are not idempotent — they throw an exception if the state is already the requested one.

### Domain exceptions

**File:** `domain/exceptions/account.exceptions.ts`

Base: `AccountException extends Error`. The controller is the only place where they are mapped to HTTP.

| Exception | HTTP |
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

### `IAccountRepository` port

Abstract class. Methods: `findById`, `findByUserId`, `save`, `delete`.

---

## Application layer

| Use case | Flow |
|----------|-------|
| `CreateAccountUseCase` | Creates VOs → creates entity → persists |
| `GetAccountByIdUseCase` | Finds by id → validates ownership (`requestUserId`) → throws `AccountNotFoundException` if it doesn't exist |
| `GetAccountsByUserIdUseCase` | Returns an array (empty is valid) |
| `RenameAccountUseCase` | Opens `IAccountUnitOfWork` → `findById` (FOR UPDATE) → inline ownership → `account.rename()` → persists |
| `ArchiveAccountUseCase` | Opens `IAccountUnitOfWork` → `findById` (FOR UPDATE) → inline ownership → `account.archive()` → persists |
| `UnarchiveAccountUseCase` | Opens `IAccountUnitOfWork` → `findById` (FOR UPDATE) → inline ownership → `account.unarchive()` → persists |
| `DeleteAccountUseCase` | Delegates to `GetAccountByIdUseCase` (existence + ownership) → `repo.delete()` — no UoW (doesn't mutate balance) |

> **Why Rename/Archive/Unarchive use the UoW and Delete doesn't:** the first three compete for the account row's lock against `CreateTransaction`/`DeleteTransaction` (see Race 2). `Delete` doesn't mutate the balance, so it doesn't need to serialize with the financial mutations.
| `UpdateAccountBalanceUseCase` | `repo.findById()` → `account.inflow()` or `account.outflow()` → `repo.save()` |

### `UpdateAccountBalanceUseCase` — consumed by `transactions`

**File:** `application/use-cases/update-account-balance.use-case.ts`

This use case IS consumed by `CreateTransactionUseCase` and `DeleteTransactionUseCase`. The `transactions` module builds an instance directly, injecting the **UoW's scoped repository**:

```typescript
// create-transaction.use-case.ts (inside the UoW block)
const acctRepo = this.uow.getAccountRepository(); // ScopedAccountRepository
const updateBalance = new UpdateAccountBalanceUseCase(acctRepo);
await updateBalance.execute(command.accountId, amount.getValue(), 'inflow' | 'outflow');
```

By using the scoped repository, the balance update runs inside the same PostgreSQL transaction as the `txRepo.save(transaction)`. This guarantees atomicity: if the transaction save fails, the balance is not updated either.

**Bug B (balance lost update) — CLOSED.** `ScopedAccountRepository.findById` takes `FOR UPDATE`, so two concurrent transactions on the same account are serialized: the second one waits for the first one's COMMIT and reads the current balance. Full post-mortem in [transactions/notes-history.md](../../transactions/notes-history.md). The competition between account mutations and transactions (Race 2) is in [docs/history/race-conditions-fix-2026-05.md](../../../docs/history/race-conditions-fix-2026-05.md).

---

## Infrastructure layer

### `AccountOrmEntity`

**File:** `infrastructure/persistance/account.orm.entity.ts`

| Column | Type | Notes |
|---------|------|-------|
| `id` | `uuid` | PK, generated with `randomUUID()` |
| `userId` | `varchar` | Logical reference |
| `name` | `varchar` | |
| `type` | `varchar` | String from the `AccountType` VO |
| `initialBalance` | `int` | CLP |
| `currentBalance` | `int` | CLP |
| `isArchived` | `boolean` | Default `false` |
| `created_at` | `timestamp` | Plain `@Column` — the domain controls the value |
| `updated_at` | `timestamp` | Plain `@Column` — the domain controls the value |

Index: `@Index('idx_account_user', ['userId'])` — the per-user listing is a hot path.

**Why a plain `@Column` instead of `@CreateDateColumn`:** TypeORM with `@CreateDateColumn`/`@UpdateDateColumn` overwrites the values on every `save()`, ignoring what the domain sets. With a plain `@Column`, the domain entity is the single source of truth for the dates.

### `AccountMapper`

`toDomain(orm)` — uses `Balance.reconstitute()` and `AccountType.reconstitute()` (doesn't re-validate persisted data). `Account.reconstitute()` to preserve timestamps.
`toOrm(domain)` — extracts values with getters.

### Routes

| Method | Route | Use case | HTTP |
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
- `GetAccountByIdUseCase` — consumed by `budgets` and `transactions` (cross-module ownership check)
- `GetAccountsByUserIdUseCase` — consumed by `transactions`
- `UpdateAccountBalanceUseCase` — consumed by `transactions`
- `IAccountRepository` — consumed by `transactions` for the UoW scoped repo

---

## Future extension: transfers

For "move $X from account A to account B":

```
TransferUseCase(fromId, toId, amount):
  uow.begin()
    txRepo.save(tx: outflow from A, transferGroupId)
    txRepo.save(tx: inflow  to B, transferGroupId)
    updateBalance(A, -amount, 'outflow')
    updateBalance(B, +amount, 'inflow')
  uow.commit()
```

Both transactions must share a `transferGroupId` to reconstruct the logical transfer. The UoW already exists — the extension is adding the field and the use case.

---

## Resources

- Book: DDIA ch. 7 — the lost update problem and pessimistic/optimistic locking
- Article: postgresql.org/docs → "Explicit Locking"
