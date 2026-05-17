# Módulo `users` — Referencia actual

## Dominio

### Value object `Email`

**Archivo:** `domain/value-objects/email.vo.ts`

Clase inmutable. Valida formato y vacío en `Email.create(raw)`. Normaliza a minúsculas. No depende de `class-validator` — TypeScript puro.

Métodos: `create(raw)`, `getValue()`, `equals()`, `getDomain()`.

El mapper usa `Email.create()` (no `reconstitute()`) porque los emails ya estaban validados al guardarse y el format check es barato. Si en el futuro cambia la regex de validación, usar `Email.reconstitute()` en el mapper para evitar que datos históricos "se rompan" al ser leídos.

### Entidad `User`

**Archivo:** `domain/entities/user.entity.ts`

Constructor privado. Dos factory methods:
- `User.create(props)` — genera `createdAt` y `updatedAt`
- `User.reconstitute(props)` — respeta fechas originales

Propiedades: `id`, `email` (`Email`), `passwordHash`, `name`, `createdAt`, `updatedAt`.

Métodos: `updateProfile(name)` → lanza `InvalidNameException` si vacío. `changePassword(newHash)` → lanza `InvalidPasswordHashException` si vacío.

### Excepciones de dominio

**Archivo:** `domain/exceptions/user.exceptions.ts`

Base: `UserException extends Error`. HTTP mapping solo en el controlador.

| Excepción | HTTP |
|-----------|------|
| `UserNotFoundException` | 404 |
| `UserAlreadyExistsException` | 409 |
| `InvalidCredentialsException` | 401 (usado por auth) |
| `InvalidNameException` | 400 |
| `InvalidPasswordHashException` | 400 |
| `EmptyEmailException` | 400 |
| `InvalidEmailFormatException` | 400 |

### Puerto `IUserRepository`

Clase abstracta. Métodos: `findById`, `findByEmail`, `save`, `delete`.

---

## Capa application

| Use case | Flujo |
|----------|-------|
| `CreateUserUseCase` | Verifica email único (`GetUserByEmailUseCase`) → hashea password con `IPasswordHasher` → crea entidad → persiste |
| `GetUserByIdUseCase` | Valida self-access (`id !== requestUserId` → `ResourceOwnershipException`) → busca → lanza `UserNotFoundException` |
| `GetUserByEmailUseCase` | Búsqueda interna para `auth` — no expuesta como endpoint HTTP |
| `UpdateUserProfileUseCase` | Valida self-access → `user.updateProfile(name)` → persiste |
| `DeleteUserUseCase` | Valida self-access → `repo.delete()` |

**Nota sobre `IPasswordHasher`:** `CreateUserUseCase` inyecta el port abstracto (no bcrypt directamente). La implementación concreta (`BcryptAdapter`) vive en `auth/infrastructure/`. El módulo `users` importa el adapter vía `AuthModule` exports. Esto permite cambiar el algoritmo de hashing sin tocar los use cases.

---

## Capa infrastructure

### `UserOrmEntity`

**Archivo:** `infrastructure/persistence/user.orm.entity.ts`

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | `uuid` | PK, generado con `randomUUID()` |
| `email` | `varchar` | `@Index('uq_users_email', { unique: true })` |
| `password_hash` | `varchar` | |
| `full_name` | `varchar` | |
| `created_at` | `timestamp` | `@Column` simple |
| `updated_at` | `timestamp` | `@Column` simple |

El índice único en `email` existe a nivel DB y es la última línea de defensa contra emails duplicados. Por qué `@Column` simple en lugar de `@CreateDateColumn`: TypeORM con `@CreateDateColumn`/`@UpdateDateColumn` sobreescribiría las fechas en cada `save()`, ignorando lo que el dominio setea.

### `UserMapper`

`toDomain(orm)` — usa `Email.create()` para reconstruir el VO. `User.reconstitute()` para preservar timestamps.  
`toOrm(domain)` — extrae valores con getters.

### `UserRepositoryImpl`

**Archivo:** `infrastructure/persistence/user.repo.implement.ts`

`save()` actual **no** tiene `catch 23505` (ver Bug E abajo). El índice único en `email` existe pero el error de Postgres se propaga como 500 en lugar de 409.

### Rutas

| Método | Ruta | Use case | HTTP |
|--------|------|----------|------|
| GET | `/users/:id` | `GetUserByIdUseCase` | 200 |
| PATCH | `/users/:id/profile` | `UpdateUserProfileUseCase` | 200 |
| DELETE | `/users/:id` | `DeleteUserUseCase` | 204 |

No hay `POST /users` — la creación de usuarios ocurre en `POST /auth/register`.

---

## Wiring — `UsersModule`

Exports: `GetUserByEmailUseCase` — consumido por `AuthModule` en el flujo de login.

---

## Bug E — Concurrent register → 500

**Archivo:** `infrastructure/persistence/user.repo.implement.ts:42`

`CreateUserUseCase` hace un `GetUserByEmailUseCase` antes de insertar (check-then-insert). En condiciones normales detecta el duplicado y lanza `UserAlreadyExistsException` → 409. Pero si dos requests llegan simultáneamente, ambas pasan el check y la segunda falla con `23505` en el `ormRepository.save()`.

`UserRepositoryImpl.save()` no tiene `try/catch`, por lo que el `QueryFailedError` sube sin mapear → NestJS devuelve 500.

**Fix (~15 minutos):**

```typescript
async save(user: User): Promise<User> {
  const orm = this.mapper.toOrm(user);
  try {
    const saved = await this.ormRepository.save(orm);
    return this.mapper.toDomain(saved);
  } catch (err) {
    if (err instanceof QueryFailedError && (err as any).driverError?.code === '23505') {
      throw new UserAlreadyExistsException(user.getEmail().getValue());
    }
    throw err;
  }
}
```

---

## Gaps de features (no bugs)

| Gap | Notas |
|----|-------|
| Email verification | Al registrarse, el email se asume válido. Real-world: token de verificación + endpoint `/auth/verify-email`. Requiere cola (BullMQ) para enviar mail sin bloquear el register. |
| Reset password | `/auth/forgot-password` → email con token → `/auth/reset-password`. Token con TTL corto (~15 min). |
| Soft delete | Hoy el delete es hard. `deletedAt` + filtros en todos los queries es más seguro para producción. |

---

## Recursos

- 📄 OWASP "Password Storage Cheat Sheet" — bcrypt vs argon2, work factors
- 📄 Martin Fowler — "Soft Deletes" (pros y contras)
