# Módulo `users` — Documentación de referencia

## Alcance V1

| Incluido                                   | Excluido                                  |
| ------------------------------------------ | ----------------------------------------- |
| Registro con email, password y nombre      | Login / generación de JWT (módulo `auth`) |
| Recuperar perfil por id                    | Recuperación de contraseña                |
| Actualizar nombre                          | Verificación de email                     |
| Eliminar cuenta                            | Roles y permisos                          |
| `GetUserByEmail` — uso interno para `auth` | Actualizar moneda por defecto             |

---

## Capa domain

### Value object `Email`

**Archivo:** `domain/value-objects/email.vo.ts`

Clase inmutable que encapsula y valida el formato de email. No depende de `class-validator` — la validación es TypeScript puro.

Métodos:

- `Email.create(raw)` — valida formato y vacío; normaliza a minúsculas
- `getValue()`, `equals()`, `getDomain()`

### Entidad `User`

**Archivo:** `domain/entities/user.entity.ts`

Clase pura sin decoradores de framework. Constructor privado con dos factory methods:

- `User.create(props)` — para usuarios nuevos; genera `createdAt` y `updatedAt`
- `User.reconstitute(props)` — para reconstruir desde persistencia; respeta las fechas originales

Propiedades: `id`, `email` (tipo `Email`), `passwordHash`, `name`, `createdAt`, `updatedAt`.

Métodos de negocio:

- `updateProfile(name)` — valida que el nombre no sea vacío; lanza `InvalidNameException`
- `changePassword(newHash)` — lanza `InvalidPasswordHashException` si el hash es vacío

### Excepciones de dominio

**Archivo:** `domain/exceptions/user.exceptions.ts`

Todas extienden la clase base `UserException extends Error`. El mapeo a HTTP ocurre exclusivamente en el controlador, nunca acá.

**Excepciones de entidad:**
| Excepción | Cuándo se lanza |
| --------- | --------------- |
| `UserNotFoundException` | Usuario no encontrado por id o email |
| `UserAlreadyExistsException` | Intento de crear usuario con email ya registrado |
| `InvalidCredentialsException` | Credenciales inválidas (reservado para módulo `auth`) |
| `InvalidNameException` | `updateProfile()` recibe nombre vacío |
| `InvalidPasswordHashException` | `changePassword()` recibe hash vacío |

**Excepciones de Value Object:**
| Excepción | Cuándo se lanza |
| --------- | --------------- |
| `EmptyEmailException` | `Email.create()` recibe string vacío |
| `InvalidEmailFormatException` | `Email.create()` recibe formato inválido |

### Repositorio

**Archivo:** `domain/repository/user.repository.ts`

Puerto de salida definido como clase abstracta (necesario para DI en NestJS — las interfaces TypeScript no existen en runtime). Métodos:

- `findById(id: string): Promise<User | null>`
- `findByEmail(email: string): Promise<User | null>`
- `save(user: User): Promise<User>`
- `delete(id: string): Promise<void>`

---

## Capa application

### Use cases

| Use case                   | Descripción                                                                 |
| -------------------------- | --------------------------------------------------------------------------- |
| `CreateUserUseCase`        | Verifica email único → hashea password con bcrypt → crea entidad → persiste |
| `GetUserByIdUseCase`       | Busca por id → lanza `UserNotFoundException` si no existe                   |
| `GetUserByEmailUseCase`    | Uso interno para `auth` — no expuesto como endpoint HTTP                    |
| `UpdateUserProfileUseCase` | Recupera via `GetUserByIdUseCase` → llama `user.updateProfile()` → persiste |
| `DeleteUserUseCase`        | Verifica existencia → elimina via repositorio → retorna `void`              |

**Nota sobre bcrypt:** `CreateUserUseCase` importa bcrypt directamente. En V2 esto debería reemplazarse con un `IPasswordHasher` abstracto inyectado por DI, para que el use case no tenga dependencia de infraestructura.

---

## Capa infrastructure

### `UserOrmEntity`

**Archivo:** `infrastructure/persistence/user.orm.entity.ts`

Entidad TypeORM completamente separada de la entidad de dominio.

| Columna         | Tipo        | Notas                                                                 |
| --------------- | ----------- | --------------------------------------------------------------------- |
| `id`            | `uuid`      | PK, generado en el use case con `randomUUID()`                        |
| `email`         | `varchar`   | Sin `unique: true` a nivel ORM — la unicidad la garantiza el use case |
| `password_hash` | `varchar`   |                                                                       |
| `full_name`     | `varchar`   |                                                                       |
| `created_at`    | `timestamp` | `@Column` simple — el dominio controla este valor                     |
| `updated_at`    | `timestamp` | `@Column` simple — el dominio controla este valor                     |

**Decisión sobre timestamps:** Se usan `@Column` simples en lugar de `@CreateDateColumn`/`@UpdateDateColumn`. TypeORM con esos decoradores sobreescribe los valores en cada `save()`, ignorando lo que el dominio setea. Al usar `@Column` simple, la entidad de dominio es la única fuente de verdad para las fechas.

### `UserMapper`

**Archivo:** `infrastructure/persistence/user.mapper.ts`

Único punto de traducción entre ORM entity y domain entity.

- `toDomain(orm)` — usa `Email.create()` para reconstruir el VO con validación; usa `User.reconstitute()` para reconstruir la entidad sin generar nuevos timestamps
- `toOrm(domain)` — extrae valores con getters del dominio

### `UserRepositoryImpl`

**Archivo:** `infrastructure/persistence/user.repo.implement.ts`

Implementa `IUserRepository` con TypeORM. Delega toda la conversión al mapper. No contiene lógica de negocio.

### DTOs

**Archivos:** `infrastructure/http/dto/`

- `CreateUserDto` — `email`, `password`, `name` con validaciones de `class-validator`
- `UpdateUserProfileDto` — `name` opcional
- `UserResponseDto` — excluye `passwordHash`; incluye `id`, `email`, `name`, `createdAt`, `updatedAt`

### `UsersController`

**Archivo:** `infrastructure/http/user-controller/user.controller.ts`

| Método | Ruta                 | Use case                   | HTTP éxito |
| ------ | -------------------- | -------------------------- | ---------- |
| POST   | `/users`             | `CreateUserUseCase`        | 201        |
| GET    | `/users/:id`         | `GetUserByIdUseCase`       | 200        |
| PATCH  | `/users/:id/profile` | `UpdateUserProfileUseCase` | 200        |
| DELETE | `/users/:id`         | `DeleteUserUseCase`        | 204        |

Mapeo de excepciones de dominio a HTTP:

| Excepción                     | HTTP |
| ----------------------------- | ---- |
| `UserNotFoundException`       | 404  |
| `UserAlreadyExistsException`  | 409  |
| `EmptyEmailException`         | 400  |
| `InvalidEmailFormatException` | 400  |
| `InvalidNameException`        | 400  |

---

## Wiring — `UsersModule`

**Archivo:** `users.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([UserOrmEntity])],
  controllers: [UsersController],
  providers: [
    UserMapper,
    CreateUserUseCase,
    GetUserByIdUseCase,
    GetUserByEmailUseCase,
    UpdateUserProfileUseCase,
    DeleteUserUseCase,
    { provide: IUserRepository, useClass: UserRepositoryImpl },
  ],
  exports: [GetUserByEmailUseCase], // consumido por el módulo auth
})
export class UsersModule {}
```

---

## Checklist de verificación

- [ ] `POST /users` crea usuario y retorna `UserResponseDto` sin `passwordHash`
- [ ] `POST /users` con email duplicado → `409 Conflict`
- [ ] `POST /users` con email inválido → `400 Bad Request`
- [ ] `GET /users/:id` retorna el usuario
- [ ] `GET /users/:id` con id inexistente → `404 Not Found`
- [ ] `PATCH /users/:id/profile` actualiza el nombre
- [ ] `PATCH /users/:id/profile` con nombre vacío → `400 Bad Request`
- [ ] `DELETE /users/:id` elimina el usuario → `204 No Content`
- [ ] `DELETE /users/:id` con id inexistente → `404 Not Found`
- [ ] El módulo `auth` puede importar `GetUserByEmailUseCase` sin errores
