# Race Conditions Fix — 2026-05

> Closure of two active races identified after the April 2026 hardening audit.
> **Final status:** 588/588 tests passing, zero new TypeScript errors introduced.

---

## Executive summary

Two race conditions were identified and closed in the personal finance API. Both compromised data integrity under concurrency:

| ID | Affected route | Risk | Status |
|----|--------------|--------|--------|
| Race 1 | `DELETE /budgets/:id` vs `POST /transactions` | Orphan expense without a budget / 500 in CreateTransaction | Closed |
| Race 2 | `PATCH /accounts/:id/{archive,unarchive,name}` vs `POST /transactions` | Overwritten balance (lost update) | Closed |

---

## Race 1 — `DELETE /budgets/:id` vs `POST /transactions`

### What was happening

`DeleteBudgetUseCase` ran entirely outside any database transaction:

```
// BEFORE (flow pseudocode)
1. hasExpensesInPeriod(userId, categoryId, month, year)  ← query without a lock
2. // ← time window: CreateTransaction can insert here
3. budgetRepository.delete(id)                           ← outside a transaction
```

**Failure scenario (TOCTOU — Time Of Check, Time Of Use):**

```
T1 (DeleteBudget)                    T2 (CreateTransaction)
─────────────────────────────────    ────────────────────────────────────
hasExpenses = false ← 0 expenses     BEGIN
                                     SELECT budget FOR UPDATE (ok, no lock in T1)
                                     expense_sum = 0 ≤ limit → ok
                                     INSERT transaction
                                     UPDATE account balance
                                     COMMIT (expense inserted)
DELETE budget ← deletes the budget
```

Result: an expense transaction exists in the period but the budget no longer exists. Invariant violated. Moreover, if `CreateTransaction` does its budget re-read under `FOR UPDATE` and `DeleteBudget` deleted the budget in the meantime → `budget!.getLimit()` blows up with a 500.

### How it was closed

`DeleteBudgetUseCase` now runs **inside `IBudgetUnitOfWork`**. `ScopedBudgetRepository.findById` takes `FOR UPDATE`, and the new `getScopedExpenseChecker()` uses the same `QueryRunner` (same `EntityManager`) with `pessimistic_write` on the expense query as well.

**Serialized sequence post-fix:**

```
T1 (DeleteBudget)                    T2 (CreateTransaction)
─────────────────────────────────    ────────────────────────────────────
BEGIN
SELECT budget FOR UPDATE             ← T2 blocks here if it touches the same budget
hasExpenses = false (under lock)
DELETE budget
COMMIT
                                     ← T2 unblocks, reads budget → doesn't exist → fails
                                       (throws BudgetNotFoundException, 422)
```

Or in the reverse order: T2 enters first, takes `FOR UPDATE` on the budget, T1 waits. T2 commits. T1 reads, `hasExpenses = true` → throws `BudgetHasTransactionsInPeriodException` (409).

---

## Race 2 — Account mutations vs `POST /transactions`

### What was happening

`ArchiveAccountUseCase`, `UnarchiveAccountUseCase` and `RenameAccountUseCase` injected the global `IAccountRepository` directly — no transaction, no `FOR UPDATE`:

```ts
// BEFORE
constructor(private readonly accountRepository: IAccountRepository) {}

async execute(dto) {
  const account = await this.accountRepository.findById(dto.id); // no lock
  account.archive();
  await this.accountRepository.save(account); // full UPDATE of the row
}
```

`CreateTransactionUseCase` and `DeleteTransactionUseCase` **did** use `ScopedAccountRepository.findById`, which takes `FOR UPDATE`. But the account-mutation use cases didn't compete for that lock → they could stomp on the balance `CreateTransaction` had just written.

**Lost-update scenario:**

```
T1 (CreateTransaction)              T2 (ArchiveAccount)
──────────────────────────────────  ──────────────────────────────────
BEGIN
SELECT account FOR UPDATE
  balance = 1000
  [processes expense transaction]
  new_balance = 800
                                    SELECT account (NO lock, NO transaction)
                                      reads balance = 1000  ← old value
UPDATE account SET balance = 800
COMMIT
                                    account.archive()
                                    UPDATE account SET
                                      balance = 1000,     ← STOMPS the 800
                                      isArchived = true
```

The account ends up archived with an incorrect balance. The financial transaction exists in the DB but the balance doesn't reflect it. **Data integrity silently compromised.**

### How it was closed

The three use cases now inject `IAccountUnitOfWork` instead of the global repository. `ScopedAccountRepository.findById` inside the UoW takes `FOR UPDATE`, competing for the same lock `CreateTransaction` uses:

```ts
// AFTER
constructor(private readonly uow: IAccountUnitOfWork) {}

async execute(dto) {
  await this.uow.begin();
  try {
    const accountRepo = this.uow.getAccountRepository(); // ScopedAccountRepository
    const account = await accountRepo.findById(dto.id);  // FOR UPDATE
    if (!account) throw new AccountNotFoundException(dto.id);
    if (account.userId !== dto.requestUserId) throw new ResourceOwnershipException(dto.id);
    account.archive();
    const saved = await accountRepo.save(account);       // same QueryRunner
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

## Changes per file

### New files

| File | What it does |
|---------|----------|
| [src/modules/accounts/domain/IAccountUnitOfWork.ts](../../src/modules/accounts/domain/IAccountUnitOfWork.ts) | UoW port for the accounts bounded context. Extends `IUnitOfWork` and adds `getAccountRepository()`. Lives in `accounts/domain` following the "port owned by consumer" pattern. |

### Modified files

| File | Change |
|---------|--------|
| [src/modules/budgets/domain/IBudgetUnitOfWork.ts](../../src/modules/budgets/domain/IBudgetUnitOfWork.ts) | Adds the abstract method `getScopedExpenseChecker(): IExpenseChecker`. |
| [src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts](../../src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts) | 1) New private class `ScopedExpenseChecker` with `hasExpensesInPeriod` + `pessimistic_write`. 2) Implements `IAccountUnitOfWork` (the `getAccountRepository()` method already existed). 3) Implements `getScopedExpenseChecker()`. |
| [src/modules/transactions/transactions.module.ts](../../src/modules/transactions/transactions.module.ts) | Adds the provider `{ provide: IAccountUnitOfWork, useExisting: TypeOrmUnitOfWorkImpl }`, exports `IAccountUnitOfWork`, changes `AccountsModule` to `forwardRef(() => AccountsModule)`. |
| [src/modules/accounts/accounts.module.ts](../../src/modules/accounts/accounts.module.ts) | Adds `forwardRef(() => TransactionsModule)` to imports (so NestJS resolves `IAccountUnitOfWork` in the use cases). |
| [src/modules/budgets/application/use-cases/delete-budget.use-case.ts](../../src/modules/budgets/application/use-cases/delete-budget.use-case.ts) | Rewritten. Removes `IBudgetRepository`, `GetBudgetByIdUseCase`, direct `IExpenseChecker`. Now injects only `IBudgetUnitOfWork`. All logic inside `begin/try/catch(rollback)/finally(release)`. |
| [src/modules/accounts/application/use-cases/archive-account.use-case.ts](../../src/modules/accounts/application/use-cases/archive-account.use-case.ts) | Rewritten. Removes `IAccountRepository` + `GetAccountByIdUseCase`. Injects `IAccountUnitOfWork`. Inline ownership check. |
| [src/modules/accounts/application/use-cases/unarchive-account.use-case.ts](../../src/modules/accounts/application/use-cases/unarchive-account.use-case.ts) | Same pattern as archive. |
| [src/modules/accounts/application/use-cases/rename-account.use-case.ts](../../src/modules/accounts/application/use-cases/rename-account.use-case.ts) | Same pattern as archive. |

### Updated tests

| File | Change |
|---------|--------|
| [src/modules/budgets/application/use-cases/delete-budget.use-case.spec.ts](../../src/modules/budgets/application/use-cases/delete-budget.use-case.spec.ts) | Rewritten with a `mockUow` that includes `getScopedExpenseChecker`. 4 tests: successful delete, budget with expenses (409), not found (404), access denied (403). |
| [src/modules/accounts/application/use-cases/archive-account.use-case.spec.ts](../../src/modules/accounts/application/use-cases/archive-account.use-case.spec.ts) | Rewritten with `makeMockUow`. 4 tests: successful archive, already archived, not found, ownership denied. |
| [src/modules/accounts/application/use-cases/unarchive-account.use-case.spec.ts](../../src/modules/accounts/application/use-cases/unarchive-account.use-case.spec.ts) | Same pattern. |
| [src/modules/accounts/application/use-cases/rename-account.use-case.spec.ts](../../src/modules/accounts/application/use-cases/rename-account.use-case.spec.ts) | Same pattern. |
| [src/modules/transactions/infrastructure/persistence/\__fakes\__/in-memory-unit-of-work.ts](../../src/modules/transactions/infrastructure/persistence/__fakes__/in-memory-unit-of-work.ts) | Implements `getScopedExpenseChecker()` required by the updated `IBudgetUnitOfWork` contract. Accepts an optional `expenseChecker` in the constructor, throws if not provided. |

---

## Architectural pattern applied

### "Port owned by consumer"

The `accounts` domain cannot import `transactions` infrastructure. For `ArchiveAccountUseCase` to use the right UoW without violating layer separation:

```
accounts/domain/IAccountUnitOfWork.ts     ← defines the contract (knows nothing about TypeORM)
         ↑ implements
transactions/infrastructure/unit-of-work.impl.ts  ← satisfies the contract
         ↓ provides via useExisting
TransactionsModule → exports: [IAccountUnitOfWork]
         ↓ imports
AccountsModule → forwardRef(() => TransactionsModule)
```

### `useExisting` — a single instance per request

```ts
// TransactionsModule providers
{ provide: TypeOrmUnitOfWorkImpl, useClass: TypeOrmUnitOfWorkImpl, scope: Scope.REQUEST }
{ provide: ITransactionUnitOfWork, useExisting: TypeOrmUnitOfWorkImpl }
{ provide: IBudgetUnitOfWork,      useExisting: TypeOrmUnitOfWorkImpl }
{ provide: IAccountUnitOfWork,     useExisting: TypeOrmUnitOfWorkImpl }
```

`useExisting` guarantees that all tokens resolve to **the same instance** of `TypeOrmUnitOfWorkImpl` within an HTTP request. One `QueryRunner` → one PostgreSQL transaction → real atomicity.

### Lock tree post-fix

| Method | Lock | Purpose |
|--------|------|-----------|
| `ScopedAccountRepository.findById` | `pessimistic_write` | Serializes balance updates (CreateTransaction, DeleteTransaction, Archive, Unarchive, Rename) |
| `ScopedBudgetRepository.findById` | `pessimistic_write` | Serializes UpdateBudgetLimit and DeleteBudget against CreateTransaction |
| `ScopedBudgetRepository.findByUserIdAndCategoryIdAndPeriod` | `pessimistic_write` | Serializes the limit check in CreateTransaction |
| `ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod` | `pessimistic_write` | Belt-and-suspenders against phantom inserts in the expense sum |
| `ScopedExpenseChecker.hasExpensesInPeriod` | `pessimistic_write` | Serializes the expense check in DeleteBudget |

---

## Circular dependency `accounts ↔ transactions`

Before this fix: `TransactionsModule` imported `AccountsModule` (for `GetAccountByIdUseCase`). Now `AccountsModule` also imports `TransactionsModule` (for `IAccountUnitOfWork`). Standard NestJS solution: `forwardRef()` on both sides.

```
TransactionsModule: imports: [forwardRef(() => AccountsModule), ...]
AccountsModule:     imports: [forwardRef(() => TransactionsModule), ...]
```

This pattern already existed for `budgets ↔ transactions` — it was replicated exactly.

---

## Final stats

```
Test Suites: 68 passed, 68 total
Tests:       588 passed, 588 total
TypeScript:  0 new errors introduced
```
