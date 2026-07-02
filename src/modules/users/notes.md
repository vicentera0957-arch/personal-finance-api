# `users` module — Current reference

## Domain

### `Email` value object

**File:** `domain/value-objects/email.vo.ts`

Immutable class. Validates format and emptiness in `Email.create(raw)`. Normalizes to lowercase. Doesn't depend on `class-validator` — pure TypeScript.

Methods: `create(raw)`, `getValue()`, `equals()`, `getDomain()`.

The mapper uses `Email.create()` (not `reconstitute()`) because emails were already validated when saved and the format check is cheap. If the validation regex changes in the future, use `Email.reconstitute()` in the mapper so historical data doesn't "break" when read.

### `User` entity

**File:** `domain/entities/user.entity.ts`

Private constructor. Two factory methods:
- `User.create(props)` — generates `createdAt` and `updatedAt`
- `User.reconstitute(props)` — respects the original dates

Properties: `id`, `email` (`Email`), `passwordHash`, `name`, `createdAt`, `updatedAt`.

Methods: `updateProfile(name)` → throws `InvalidNameException` if empty. `changePassword(newHash)` → throws `InvalidPasswordHashException` if empty.

### Domain exceptions

**File:** `domain/exceptions/user.exceptions.ts`

Base: `UserException extends Error`. HTTP mapping only in the controller.

| Exception | HTTP |
|-----------|------|
| `UserNotFoundException` | 404 |
| `UserAlreadyExistsException` | 409 |
| `InvalidCredentialsException` | 401 (used by auth) |
| `InvalidNameException` | 400 |
| `InvalidPasswordHashException` | 400 |
| `EmptyEmailException` | 400 |
| `InvalidEmailFormatException` | 400 |

### `IUserRepository` port

Abstract class. Methods: `findById`, `findByEmail`, `save`, `delete`.

---

## Application layer

| Use case | Flow |
|----------|-------|
| `CreateUserUseCase` | Verifies the email is unique (`GetUserByEmailUseCase`) → hashes the password with `IPasswordHasher` → creates entity → persists |
| `GetUserByIdUseCase` | Validates self-access (`id !== requestUserId` → `ResourceOwnershipException`) → finds → throws `UserNotFoundException` |
| `GetUserByEmailUseCase` | Internal lookup for `auth` — not exposed as an HTTP endpoint |
| `UpdateUserProfileUseCase` | Validates self-access → `user.updateProfile(name)` → persists |
| `DeleteUserUseCase` | Validates self-access → `repo.delete()` |

**Note on `IPasswordHasher`:** `CreateUserUseCase` injects the abstract port (not bcrypt directly). The concrete implementation (`BcryptPasswordHasher`) lives in `auth/infrastructure/adapters/`. The `users` module imports the adapter via `AuthModule` exports. This allows changing the hashing algorithm without touching the use cases.

---

## Infrastructure layer

### `UserOrmEntity`

**File:** `infrastructure/persistence/user.orm.entity.ts`

| Column | Type | Notes |
|---------|------|-------|
| `id` | `uuid` | PK, generated with `randomUUID()` |
| `email` | `varchar` | `@Index('uq_users_email', { unique: true })` |
| `password_hash` | `varchar` | |
| `full_name` | `varchar` | |
| `created_at` | `timestamp` | Plain `@Column` |
| `updated_at` | `timestamp` | Plain `@Column` |

The unique index on `email` exists at the DB level and is the last line of defense against duplicate emails. Why a plain `@Column` instead of `@CreateDateColumn`: TypeORM with `@CreateDateColumn`/`@UpdateDateColumn` would overwrite the dates on every `save()`, ignoring what the domain sets.

### `UserMapper`

`toDomain(orm)` — uses `Email.create()` to rebuild the VO. `User.reconstitute()` to preserve timestamps.
`toOrm(domain)` — extracts values with getters.

### `UserRepositoryImpl`

**File:** `infrastructure/persistence/user.repo.implement.ts`

`save()` catches `QueryFailedError` with `code === '23505'` → throws `UserAlreadyExistsException` (409). The unique index on `email` is the DB-level guarantee; the catch prevents the Postgres error from propagating as a 500. (Closes the old Bug E — post-mortem in [notes-history.md](./notes-history.md).)

### Routes

| Method | Route | Use case | HTTP |
|--------|------|----------|------|
| GET | `/users/:id` | `GetUserByIdUseCase` | 200 |
| PATCH | `/users/:id/profile` | `UpdateUserProfileUseCase` | 200 |
| DELETE | `/users/:id` | `DeleteUserUseCase` | 204 |

There is no `POST /users` — user creation happens in `POST /auth/register`.

---

## Wiring — `UsersModule`

Exports: `GetUserByEmailUseCase` — consumed by `AuthModule` in the login flow.

---

## Bug E — Concurrent register → 500 (RESOLVED)

Closed: `UserRepositoryImpl.save()` now catches `QueryFailedError` with `code === '23505'` → `UserAlreadyExistsException` (409). The full post-mortem (scenario + fix) is in [notes-history.md](./notes-history.md).

---

## Feature gaps (not bugs)

| Gap | Notes |
|----|-------|
| Email verification | On register, the email is assumed valid. Real-world: verification token + `/auth/verify-email` endpoint. Requires a queue (BullMQ) to send the mail without blocking the register. |
| Password reset | `/auth/forgot-password` → email with token → `/auth/reset-password`. Token with a short TTL (~15 min). |
| Soft delete | Today the delete is hard. `deletedAt` + filters on every query is safer for production. |

---

## Resources

- Article: OWASP "Password Storage Cheat Sheet" — bcrypt vs argon2, work factors
- Article: Martin Fowler — "Soft Deletes" (pros and cons)
