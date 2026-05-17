# Personal Finance API

NestJS + TypeORM REST API for personal finance management.  
Domain-Driven Design, PostgreSQL, JWT authentication.

---

## Quick start

**Prerequisites:** Docker Desktop, Node 20+

**1. Copy the environment file**

```env
# .env (create at project root)
JWT_SECRET=change-me-dev
JWT_REFRESH_SECRET=change-me-refresh-dev
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

The app validates these at startup via Joi — missing or empty vars crash immediately with a clear error message.

**2. Start the database**

```bash
docker-compose up -d
```

- PostgreSQL → `localhost:5432`
- pgAdmin → `http://localhost:5050` (credentials in `docker-compose.yml`)

**3. Run the API**

```bash
npm install
npm run start:dev
```

API → `http://localhost:3000`  
Swagger → `http://localhost:3000/api/docs`

> `synchronize: true` is active in dev — TypeORM auto-creates and migrates tables on startup. Never enable this in production.

---

## Status — 2026-04-26

### ✅ Working correctly

| Module           | Notes                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**         | Register, login, refresh. JWT global guard + `@Public()` opt-out. Rate limiting (5 req/min) on `/auth/*`. Timing-safe login (dummy bcrypt on unknown email).           |
| **Users**        | CRUD. Ownership enforced — only your own profile.                                                                                                                      |
| **Accounts**     | Full lifecycle: create, rename, archive/unarchive, delete. Balance updated atomically inside a DB transaction on every create/delete of a transaction.                 |
| **Categories**   | CRUD. Nature (`income`/`expense`) is immutable after creation. Duplicate prevention via DB unique constraint + mapped 409.                                             |
| **Budgets**      | One budget per (user, category, month, year). Unique constraint + `catch 23505` → 409. Expense transactions require an active budget and cannot exceed the limit.      |
| **Transactions** | Create + delete only (no update — correction = delete + recreate). Runs inside `IUnitOfWork` with a PostgreSQL transaction. Pessimistic lock on the expense SUM query. |

### 🐛 Active bugs (confirmed race conditions)

These don't affect single-user / low-concurrency use, but can corrupt data under concurrent load.

| ID        | Severity | Where it bites                                             | Root cause                                                                                                                                                                                                                                                                              | Fix                                                                           |
| --------- | -------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------- |
| **Bug A** | Medium   | `PATCH /budgets/:id/limit` races with `POST /transactions` | `UpdateBudgetLimitUseCase` reads the budget row without a `FOR UPDATE` lock (`unit-of-work.impl.ts:148`). `CreateTransactionUseCase` reads the budget a second time using the globally-injected use case — outside the UoW transaction entirely (`create-transaction.use-case.ts:111`). | Add `findByIdForUpdate` to `IBudgetRepository` and use it in both places.     | write skew          |
| **Bug B** | Medium   | Two concurrent `POST /transactions` on the same account    | `ScopedAccountRepository.findById` uses a plain `manager.findOne` with no lock (`unit-of-work.impl.ts:119`). Both requests read the same balance, compute new balances in memory, and write absolute values — the second write wins.                                                    | Add `SELECT ... FOR UPDATE` to `ScopedAccountRepository.findById`.            | lost update         |
| **Bug E** | Low      | Two concurrent `POST /auth/register` with the same email   | `UserRepositoryImpl.save` has no `catch 23505` (`user.repo.implement.ts:42`). The DB unique index fires but the raw Postgres error bubbles up as a 500 instead of mapping to a 409.                                                                                                     | Add `try/catch QueryFailedError` → `UserAlreadyExistsException`. ~15 min fix. | gestionar exception |

### ⚠️ Structural gaps (not crashes, just missing)

| Gap                             | Impact                                                                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No initial schema migration** | Only `ALTER TABLE` migration exists (`1745366400000-AddBudgetUniqueConstraint.ts`). Fresh production deploy with `synchronize: false` → "relation does not exist". Dev is fine because `synchronize: true`. |
| **No refresh token rotation**   | `refresh-token.use-case.ts` is 19 lines — no DB interaction, no reuse detection. A stolen refresh token is valid for 7 days with no revocation path.                                                        |

---

## Architecture

See [CLAUDE.md](./CLAUDE.md) for:

- DDD three-layer module structure
- Cross-module dependency rules and the `IExpenseChecker` port pattern
- Ownership validation (`ResourceOwnershipException` → 403)
- `IUnitOfWork` transactional boundary (how transactions + accounts share one QueryRunner)
- Full endpoint reference for all 6 modules
- Race conditions table with exact file:line references

---

## Running tests

```bash
npm run test          # unit tests (domain + use cases)
npm run test:e2e      # integration tests
npm run test:cov      # coverage report
```

Coverage status:

- Domain layer (entities + VOs): ✅ complete
- Use case layer: ✅ unit tests complete, integration tests under revision
- Infrastructure / HTTP layer: under revision
