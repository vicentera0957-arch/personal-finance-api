# Módulo `auth` — Referencia actual

## Arquitectura de autenticación

### JwtAuthGuard (global)

Registrado como `APP_GUARD` en `auth.module.ts`. Valida el JWT en cada request excepto rutas marcadas con `@Public()`. Payload del token: `{ sub: userId, email, iat, exp }`.

### `@CurrentUser()` decorator

**Archivo:** `infrastructure/decorators/current-user.decorator.ts`

Tipo: `AuthenticatedUser = { userId: string, email: string }`. Inyecta el usuario autenticado en parámetros de controller. Solo funciona en rutas protegidas.

**Regla:** `userId` nunca viene del body ni de la URL. Solo de `@CurrentUser()`.

### Ports

| Port | Implementación | Ubicación |
|------|---------------|-----------|
| `IPasswordHasher` | `BcryptAdapter` | `infrastructure/adapters/bcrypt.adapter.ts` |
| `ITokenProvider` | `JwtTokenProvider` | `infrastructure/adapters/jwt-token.provider.ts` |

Los use cases de auth inyectan los ports abstractos — no bcrypt ni JWT directamente. Esto permite testear sin el costo computacional de bcrypt.

### Variables de entorno requeridas

Validadas con Joi en `infrastructure/config/env.validation.ts` — el proceso no arranca si faltan.

```
JWT_SECRET
JWT_REFRESH_SECRET
JWT_ACCESS_EXPIRES_IN   # e.g. "15m"
JWT_REFRESH_EXPIRES_IN  # e.g. "7d"
```

---

## Use cases

### `RegisterUseCase`

`POST /auth/register` es `@Public()`. Delega la creación del usuario a `CreateUserUseCase` (módulo `users`). Retorna tokens de acceso + refresh.

### `LoginUseCase`

1. Busca el user por email con `GetUserByEmailUseCase`
2. Si el user NO existe: ejecuta `bcrypt.compare` contra un **hash dummy** de todos modos — timing-safe para no revelar si el email está registrado
3. Compara hash con `IPasswordHasher.compare`
4. Si falla: `InvalidCredentialsException` (mismo mensaje que si el user no existiera — sin señales para el atacante)
5. Genera tokens con `ITokenProvider`

**Por qué timing-safe:** sin el hash dummy, la latencia de ~5ms (user no existe) vs ~100ms (hash compare) permite enumerar emails válidos con suficientes requests.

### `RefreshTokenUseCase`

Valida el refresh token con `ITokenProvider.verifyRefresh` → genera nuevo access token.

⚠️ **Gap:** no hay rotación ni revocación de refresh tokens. Retorna un nuevo access token sin invalidar el refresh token anterior ni tocar la DB. Un refresh token robado es válido durante todo su TTL (default `7d`).

---

## Ownership validation (implementado 2026-04-11)

### Principio

**La validación de ownership ocurre en el use case, nunca en el controller ni en la entidad.**

```typescript
// GetAccountByIdUseCase — puerta central
async execute(id: string, requestUserId: string): Promise<Account> {
  const account = await this.accountRepository.findById(id);
  if (!account) throw new AccountNotFoundException(id);
  if (account.userId !== requestUserId) throw new ResourceOwnershipException(id);
  return account;
}
```

Todos los use cases que mutan un recurso (`rename`, `archive`, `delete`, etc.) delegan a `getXByIdUseCase` y heredan la validación automáticamente.

### `ResourceOwnershipException`

**Archivo:** `src/shared/domain/exceptions/resource-ownership.exception.ts`

Excepción genérica compartida por todos los módulos. Controllers la mapean a `ForbiddenException` (403). Es genérica porque todos los casos mapean a 403 y no necesitamos granularidad.

### Patrones de ownership en la codebase

| Patrón | Afectados |
|--------|-----------|
| **Get-by-ID como puerta** | `GetAccountByIdUseCase`, `GetCategoryByIdUseCase`, `GetBudgetByIdUseCase`, `GetTransactionByIdUseCase` |
| **Operaciones que delegan al get** | `RenameAccount`, `Archive`, `Unarchive`, `DeleteAccount`, `UpdateBudgetLimit`, `DeleteBudget`, etc. |
| **Cross-module** | `CreateBudgetUseCase` (valida que la category pertenece al usuario), `CreateTransactionUseCase` (valida account + category) |
| **Self-access en users** | `GetUserByIdUseCase`, `UpdateUserProfileUseCase`, `DeleteUserUseCase` — solo tu propio perfil |

### Rutas de colección — sin `:userId` en la URL

```
ANTES: GET /accounts/user/:userId   ← vulnerable, el cliente pasaba cualquier userId
AHORA: GET /accounts                ← userId viene del JWT, solo lista tus propias cuentas
```

---

## Rate limiting

`@nestjs/throttler` con dos throttlers:
- `default` — 100 req/min (global)
- `auth` — 5 req/min en `AuthController`

Previene fuerza bruta de login, spam de registros y abuso de refresh.

---

## Gaps prioritarios

| Prioridad | Gap |
|-----------|-----|
| Alta | **Refresh token rotation + revocación** — requiere tabla `refresh_tokens`, nuevo port, reuse-detection. Sin esto, un refresh robado es válido 7 días. |
| Media | **Logout endpoint** — hoy no existe. Un usuario no puede invalidar sus tokens activos. |
| Baja | **OAuth Google/GitHub** — `passport-google-oauth20` / `passport-github2`. Plug-in sobre la arquitectura existente sin tocar dominio. |
| Baja | **JWT `jti`** — claim de ID único por token. Necesario para revocación individual. |

---

## Recursos

- 📄 **Auth0 Blog → "Refresh Token Rotation"** — diagrama del reuse-detection
- 🎥 **"OAuth 2.0 and OpenID Connect (in plain English)"** — Nate Barbettini (OktaDev), 1h
- 📄 **RFC 7519** (JWT) — sección 4 (claims)
- 📄 **OWASP Authentication Cheat Sheet**
- 📄 **OWASP "Password Storage Cheat Sheet"** — bcrypt vs argon2, work factors
