# `categories` module — Current reference

## Domain

### `CategoryNature` value object

**File:** `domain/value-objects/category-nature.vo.ts`

Closed list normalized to lowercase: `income` | `expense`. It doesn't include `transfer` — transfers are a separate entity.

It has a `reconstitute()` method separate from `create()`. The mapper always uses `reconstitute()` when reading from the DB so as not to re-validate already-persisted data.

Why a VO and not a string: rule R7 ("an expense category only classifies expenses") needs a centralized representation. With an arbitrary string, any part of the system could create a category with `nature = "foo"`. With the VO it is impossible.

### `Category` entity

**File:** `domain/entities/category.entity.ts`

Private constructor. Two factory methods (`create`, `reconstitute`).

Properties: `id`, `userId`, `name`, `nature` (`CategoryNature`), `color?`, `icon?`, `createdAt`, `updatedAt`.

Methods: `rename(name)`, `changeColor(color)`, `changeIcon(icon)`. **There is no `setBudgetable`** — budgetability is derived from `nature === 'expense'`, not from a flag.

**There is no `changeNature()`** — the nature is immutable after creation. Changing it would break invariant R7 for all of that category's existing transactions.

### Domain exceptions

| Exception | HTTP |
|-----------|------|
| `CategoryNotFoundException` | 404 |
| `DuplicateCategoryException` | 409 |
| `CategoryInUseException` | 409 |
| `InvalidCategoryNameException` | 400 |
| `InvalidCategoryColorException` | 400 |
| `InvalidCategoryIconException` | 400 |
| `InvalidCategoryNatureException` | 400 |

### `ICategoryRepository` port

Abstract class. Methods: `findById`, `findByUserId`, `save`, `delete`.

It has no `findByUserIdAndNameAndNature` method — duplicate validation happens at the DB level (see below).

---

## Application layer

| Use case | Flow |
|----------|-------|
| `CreateCategoryUseCase` | Creates the `CategoryNature` VO → creates entity → persists → the repository catches `23505` → `DuplicateCategoryException` |
| `GetCategoryByIdUseCase` | Finds → validates ownership → throws `CategoryNotFoundException` |
| `GetCategoriesByUserIdUseCase` | Returns an array (empty is valid) |
| `UpdateCategoryUseCase` | Delegates to `GetCategoryByIdUseCase` → applies optional fields → persists |
| `DeleteCategoryUseCase` | Verifies existence and ownership → `repo.delete()` → the repo catches FK violation `23503` → `CategoryInUseException` |

**About `CreateCategoryUseCase`:** it doesn't do a prior `findByUserId...` to detect duplicates. The check is 100% at the DB level — `CategoryRepositoryImpl.save()` catches `QueryFailedError` with `code === '23505'` and throws `DuplicateCategoryException`. This closes the "check-then-insert" race condition without needing a prior query.

**About `UpdateCategoryUseCase`:** a single use case for all editable fields (`name`, `color`, `icon`). All optional. No complex side effects — just "edit metadata". Unlike `accounts`, there is no split into granular use cases because there are no operations with state consequences (like archiving).

> **`isBudgetable` was removed.** A category's budgetability is derived from `nature === 'expense'` — there is no domain flag or DB column, and there is no `CategoryBudgetableImmutableException`. Reintroducing the flag is forbidden (see the anti-patterns in CLAUDE.md): it created two sources of truth that drifted.

---

## Infrastructure layer

### `CategoryOrmEntity`

**File:** `infrastructure/persistence/category.orm.entity.ts`

| Column | Type | Notes |
|---------|------|-------|
| `id` | `uuid` | PK, generated with `randomUUID()` |
| `userId` | `varchar` | Logical reference |
| `name` | `varchar` | Maximum 80 characters |
| `nature` | `varchar` | `income` or `expense` |
| `color` | `varchar` | Nullable |
| `icon` | `varchar` | Nullable |
| `createdAt` | `timestamp` | Plain `@Column` |
| `updatedAt` | `timestamp` | Plain `@Column` |

`@Unique(['userId', 'name', 'nature'])` — DB-level constraint.

### `CategoryRepositoryImpl`

**File:** `infrastructure/persistence/category.repo.implement.ts`

`save()` catches `QueryFailedError`:
- `code === '23505'` → `DuplicateCategoryException` (409)
- `code === '23503'` → `CategoryInUseException` (409) (in `delete()`)

### `CategoryMapper`

`toDomain(orm)` — uses `CategoryNature.reconstitute()` (not `create()`). `Category.reconstitute()` to preserve timestamps.

### Routes

| Method | Route | Use case | HTTP |
|--------|------|----------|------|
| POST | `/categories` | `CreateCategoryUseCase` | 201 |
| GET | `/categories` | `GetCategoriesByUserIdUseCase` | 200 |
| GET | `/categories/:id` | `GetCategoryByIdUseCase` | 200 |
| PATCH | `/categories/:id` | `UpdateCategoryUseCase` | 200 |
| DELETE | `/categories/:id` | `DeleteCategoryUseCase` | 204 |

---

## Wiring — `CategoriesModule`

Exports: `GetCategoryByIdUseCase` — consumed by `budgets` (validates the category when creating a budget) and by `transactions` (validates R7 + cross-module ownership).

---

## Defense in depth for the delete

The rule "don't delete a category in use" has two layers:

1. **Repository:** `delete()` catches `23503` → `CategoryInUseException`
2. **Database:** FK with `onDelete: 'RESTRICT'` on the `transactions` and `budgets` tables

If the application layer failed for any reason, Postgres rejects the DELETE anyway. It is the defense-in-depth pattern applied to referential integrity.

---

## Sub-categories (future extension)

For "Food → Restaurants, Supermarket", three classic patterns:
- **Adjacency list** (`parentId` self-FK) — easy INSERT, expensive to read the full hierarchy
- **Materialized path** (`path = '1/4/17'`) — easy reads, expensive to move branches
- **Nested sets** (`lft`, `rgt`) — O(1) reads, expensive INSERT

For a personal finance app, adjacency list + `WITH RECURSIVE` is enough.

---

## Resources

- Article: "Trees and Hierarchies in SQL" — Joe Celko
- Video: Ben Awad — "Recursive CTEs in PostgreSQL"
- Article: postgresql.org/docs → "WITH Queries (Common Table Expressions)"
