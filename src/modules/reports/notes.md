# `reports` module — Current reference

## Concept

`reports` is a **read model** (CQRS-lite), not a bounded context with its own write invariants. v1 has one endpoint: a monthly financial summary — income, expenses, net — scoped to the authenticated user.

Its only link to `transactions` is at the **schema** level (it reads the `v_period_expenses` view, which is defined over the `transactions` table). There is zero compile-time coupling: `ReportsModule` imports nothing.

---

## No `domain/` layer (documented exception)

Every other module has `domain/ → application/ → infrastructure/`. `reports` deliberately skips `domain/`: no entities, no value objects, no mappers, no `reconstitute()`, no UoW, no locks.

Reasoning: a read model has no write-side invariants to protect, so the machinery that protects them (rich entities, VO re-validation, pessimistic locks) would be pure cost. The exception is scoped to **pure read aggregation** — the day `reports` needs to mutate state or enforce an invariant, it gets promoted to a full module with a `domain/` layer.

With no `domain/`, the innermost layer is `application/`, so the port lives there instead of in `domain/repository/` like every other module's ports.

---

## Application layer

### `IReportsReadStore` port

**File:** `application/ports/reports-read-store.port.ts`

Abstract class (DI-token convention — same reason every other port in the repo is an abstract class, not a `interface`). One method: `getPeriodTotals(userId, period): Promise<{ income, expenses }>`.

### `GetPeriodSummaryUseCase`

**File:** `application/use-cases/get-period-summary.use-case.ts`

Derives the `[start, end)` period with the shared `monthPeriod()` helper (`shared/domain/month-period.ts`), asks the read store for totals, and computes `net = income - expenses` in TypeScript.

Throws no domain exceptions. An empty period is a valid result (all zeros), not a missing resource — so it returns `200`, never `404`. This is why the module doesn't add any row to the exception→HTTP table in `CLAUDE.md`.

---

## Infrastructure layer

### `ReportsReadStoreImpl`

**File:** `infrastructure/persistence/reports-read-store.impl.ts`

Injects `DataSource` directly — this is **not** the anti-pattern CLAUDE.md forbids ("don't inject `DataSource` in a use case"): that rule protects the write-side lock model, and there is no lock here to bypass. Same precedent as `TypeOrmUnitOfWorkImpl`, which also injects `DataSource`.

Runs **one SQL statement** with two scalar subqueries — expenses from `v_period_expenses`, income inline from `transactions`. One statement means one MVCC snapshot under READ COMMITTED, so both figures are mutually consistent without opening a transaction. `SUM` returns as a string from `pg`; converted with `Number(row?.x ?? 0)`, same pattern used across the UoW aggregates.

### `__fakes__/in-memory-reports-read-store.ts`

Fake used by the use-case spec (no `TestingModule`, no DB). Filters by `userId` and by the half-open `[start, end)` window so the unit tests actually exercise boundary and isolation logic instead of trusting a stub.

### HTTP

**Query DTO** (`get-report-summary-query.dto.ts`): `month`/`year` are **required**, unlike `budgets`'s equivalent DTO where they're optional. A "current month" default would depend on the server's timezone — the same ambiguity flagged as a pending investigation. Requiring the pair also caps query cost to a single month by construction.

**Response DTO** (`report-summary-response.dto.ts`): plain class with `@ApiProperty`, same shape as every other response DTO in the repo.

**Controller** (`reports-controller/reports.controller.ts`): no `try/catch` — there's nothing to map, since the use case never throws a domain exception.

### Routes

| Method | Route                              | Use case                  | HTTP |
| ------ | ----------------------------------- | -------------------------- | ---- |
| GET    | `/reports/summary?month=&year=`     | `GetPeriodSummaryUseCase`  | 200  |

---

## Wiring — `ReportsModule`

No `imports`. No `TypeOrmModule.forFeature` — there's no ORM entity, since the view is queried with raw SQL through `DataSource` (already globally injectable; `TypeOrmCoreModule` is `@Global`). No dependency on `TransactionsModule` at the DI level — the dependency on `transactions` exists only at the schema level, via the view.

---

## Cross-module building blocks (shared, not owned by `reports`)

These two pieces were introduced alongside `reports` but are consumed by both `reports` and the budget-enforcement code in `transactions` — neither belongs to a single module.

### `v_period_expenses` (DB view)

**Migration:** `database/migrations/1783292601885-CreatePeriodExpensesView.ts`

The single definition of "what counts as an expense" (`nature = 'expense'`), read by both `GET /reports/summary` and the three aggregate queries in `TypeOrmUnitOfWorkImpl` (`sumExpenseAmountByUserCategoryAndPeriod`, `hasExpensesInPeriod`, `sumExpenseAmountInPeriod`). If that definition lived in two separate SQL statements, they could drift and the system would contradict itself — the enforcement path rejecting a spend while the reports path shows a different total for the same data. Same category of bug the repo already paid for once with `isBudgetable`.

**Not** registered as a `@ViewEntity` on purpose: TypeORM only manages views tracked in `typeorm_metadata`, so a hand-written SQL view is invisible to `migration:generate` (confirmed with a dry-run — it reports "No changes"). Never accept a generated migration that tries to recreate or `DROP` it.

**Note:** `DB_SYNCHRONIZE=true` never creates this view — `synchronize` only builds tables from entities, and this view has no entity. A dev DB built that way needs `migration:run` regardless.

### `monthPeriod()` helper

**File:** `shared/domain/month-period.ts`

Single definition of a monthly period's `[start, end)` bounds, used by `reports` and by the same three UoW aggregates (previously each computed `new Date(year, month - 1, 1)` inline, duplicated three times). Copies the exact semantics that already existed — it's the single point to fix the pending timezone-semantics question (`transaction_date` is `TIMESTAMP` without zone; bounds are computed in the server's local time), not a fix in itself.

---

## No cache in v1

The repo has a per-module Redis cache pattern (`IBudgetsCache`). `reports` skips it deliberately: invalidating a reports cache would couple `transactions → reports` (every `Create`/`DeleteTransaction` would have to bust report keys). Deferred until monitoring shows a need.

---

## Resources

- Book: DDIA ch. 2 vs ch. 3 — data model vs. storage layout are orthogonal axes; this module is an OLTP aggregation query, not OLAP (the request is always scoped by `user_id`, so it never scans a large fraction of the table)
- Book: DDIA ch. 7 — snapshot isolation / MVCC, applied here to "read consistency across the columns of one report row" rather than across writes
- Article: postgresql.org/docs → "Rules and the Query Language" (why a view is inlined, not materialized)
