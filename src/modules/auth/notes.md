# `auth` module — Current reference

## Authentication architecture

### JwtAuthGuard (global)

Registered as `APP_GUARD` in `auth.module.ts`. Validates the JWT on every request except routes marked with `@Public()`. Token payload: `{ sub: userId, email, iat, exp }`.

### `@CurrentUser()` decorator

**File:** `infrastructure/decorators/current-user.decorator.ts`

Type: `AuthenticatedUser = { userId: string, email: string }`. Injects the authenticated user into controller parameters. Only works on protected routes.

**Rule:** `userId` never comes from the body or the URL. Only from `@CurrentUser()`.

### Ports

| Port | Implementation | Location |
|------|---------------|-----------|
| `IPasswordHasher` | `BcryptPasswordHasher` | `infrastructure/adapters/bcrypt-password-hasher.ts` |
| `ITokenProvider` | `JwtTokenProvider` | `infrastructure/adapters/jwt-token-provider.ts` |

The auth use cases inject the abstract ports — not bcrypt or JWT directly. This allows testing without bcrypt's computational cost.

### Required environment variables

Validated with Joi in `infrastructure/config/env.validation.ts` — the process doesn't start if they are missing.

```
JWT_SECRET
JWT_REFRESH_SECRET
JWT_ACCESS_EXPIRES_IN   # e.g. "15m"
JWT_REFRESH_EXPIRES_IN  # e.g. "7d"
```

---

## Use cases

### `RegisterUseCase`

`POST /auth/register` is `@Public()`. Delegates user creation to `CreateUserUseCase` (`users` module). Returns access + refresh tokens.

### `LoginUseCase`

1. Looks up the user by email with `GetUserByEmailUseCase`
2. If the user does NOT exist: runs `bcrypt.compare` against a **dummy hash** anyway — timing-safe so as not to reveal whether the email is registered
3. Compares the hash with `IPasswordHasher.compare`
4. On failure: `InvalidCredentialsException` (same message as if the user didn't exist — no signals for the attacker)
5. Generates tokens with `ITokenProvider`

**Why timing-safe:** without the dummy hash, the ~5ms latency (user doesn't exist) vs ~100ms (hash compare) allows enumerating valid emails with enough requests.

### Refresh tokens — model

Persisted in `refresh_tokens`. **The plaintext token is never stored** — only `sha256(token)`. Each row: `id` (= the `jti` claim), `familyId` (same UUID for the whole rotation chain), `tokenHash` (unique), `expiresAt`, `revokedAt`, `replacedById`. A `@Cron('0 3 * * *')` (scheduler) deletes expired ones daily.

### `RefreshTokenUseCase`

Rotation with replay detection, all inside `IAuthUnitOfWork` (one PG transaction):

1. Verifies the signature (`ITokenProvider.verifyRefreshToken`) — fail-fast without touching the DB if the token is corrupt.
2. Opens the UoW and reads the row by `sha256(token)` with `FOR UPDATE` (`findByTokenHashWithLock`) — serializes two simultaneous `/refresh` calls with the same token.
3. Doesn't exist → `InvalidRefreshTokenException` (401).
4. **Revoked → replay detected:** revokes the entire family (`revokeFamily`), **commits** the revocation (on purpose) and throws `RefreshTokenReplayDetectedException` (401).
5. Expired → `RefreshTokenExpiredException` (401).
6. Valid → inserts the new token (same `familyId`), revokes the old one (`replacedById = new jti`), returns the new pair. Inserts the new one **before** revoking the old one, because of the self-referential `replacedById` FK.

### `LogoutUseCase`

`POST /auth/logout` is `@Public()` → revokes the submitted refresh token. Public on purpose: an expired access token must not prevent signing out.

---

## Ownership validation (implemented 2026-04-11)

### Principle

**Ownership validation happens in the use case, never in the controller or the entity.**

```typescript
// GetAccountByIdUseCase — central gate
async execute(id: string, requestUserId: string): Promise<Account> {
  const account = await this.accountRepository.findById(id);
  if (!account) throw new AccountNotFoundException(id);
  if (account.userId !== requestUserId) throw new ResourceOwnershipException(id);
  return account;
}
```

All use cases that mutate a resource (`rename`, `archive`, `delete`, etc.) delegate to `getXByIdUseCase` and inherit the validation automatically.

### `ResourceOwnershipException`

**File:** `src/shared/domain/exceptions/resource-ownership.exception.ts`

Generic exception shared by all modules. Controllers map it to `ForbiddenException` (403). It is generic because all cases map to 403 and we don't need granularity.

### Ownership patterns in the codebase

| Pattern | Affected |
|--------|-----------|
| **Get-by-ID as gate** | `GetAccountByIdUseCase`, `GetCategoryByIdUseCase`, `GetBudgetByIdUseCase`, `GetTransactionByIdUseCase` |
| **Operations delegating to the get** | `RenameAccount`, `Archive`, `Unarchive`, `DeleteAccount`, `UpdateBudgetLimit`, `DeleteBudget`, etc. |
| **Cross-module** | `CreateBudgetUseCase` (validates the category belongs to the user), `CreateTransactionUseCase` (validates account + category) |
| **Self-access in users** | `GetUserByIdUseCase`, `UpdateUserProfileUseCase`, `DeleteUserUseCase` — only your own profile |

### Collection routes — no `:userId` in the URL

```
BEFORE: GET /accounts/user/:userId   ← vulnerable, the client passed any userId
NOW:    GET /accounts                ← userId comes from the JWT, lists only your own accounts
```

---

## Rate limiting

`@nestjs/throttler` with two throttlers:
- `default` — 100 req/min (global)
- `auth` — 5 req/min on `AuthController`

Prevents login brute force, registration spam and refresh abuse.

---

## Priority gaps

| Priority | Gap |
|-----------|-----|
| Low | **OAuth Google/GitHub** — `passport-google-oauth20` / `passport-github2`. Plugs into the existing architecture without touching the domain. |

> **Refresh token rotation + family revocation, logout and `jti` are already implemented** (2026 hardening). See the refresh-token model above and the history of closed gaps in [notes-history.md](./notes-history.md).

---

## Resources

- Article: **Auth0 Blog → "Refresh Token Rotation"** — reuse-detection diagram
- Video: **"OAuth 2.0 and OpenID Connect (in plain English)"** — Nate Barbettini (OktaDev), 1h
- Article: **RFC 7519** (JWT) — section 4 (claims)
- Article: **OWASP Authentication Cheat Sheet**
- Article: **OWASP "Password Storage Cheat Sheet"** — bcrypt vs argon2, work factors
