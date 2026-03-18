# Implementación de la feature `users`

---

## Paso 0 — Definir el alcance

Antes de escribir una sola línea de código, documentar qué hace y qué no hace esta feature en V1.

### Casos de uso — V1

- `CreateUser` — registro con email, password y nombre
- `GetUserById` — recuperar perfil por id
- `GetUserByEmail` — uso interno, necesario para auth
- `UpdateUserProfile` — actualizar nombre
- `DeleteUser` — baja de cuenta

### Casos de uso — fuera de scope en V1

- Login / generación de JWT (pertenece al módulo `auth`)
- Recuperación de contraseña
- Verificación de email
- Roles y permisos

### Resultado esperado

Un archivo `src/modules/users/README.md` con esta misma definición, que sirva de contrato para el equipo antes de implementar.

---

## Paso 1 — Capa domain

### 1.1 Value object `Email`

**Archivo:** `domain/value-objects/email.vo.ts`

Clase inmutable que encapsula la validación del formato de email. Lanza una excepción de dominio si el formato es inválido. No depende de `class-validator` — la validación es pura TypeScript.

### 1.2 Entidad `User`

**Archivo:** `domain/entities/user.entity.ts`

Clase pura sin decoradores. Constructor privado con dos factory methods:

- `User.create()` — para usuarios nuevos, genera `createdAt` y `updatedAt`
- `User.reconstitute()` — para reconstruir desde persistencia, respeta fechas originales

Propiedades: `id`, `email` (tipo `Email`), `passwordHash`, `name`, `createdAt`, `updatedAt`.

Métodos de dominio: `updateProfile(name)`, `changePassword(newHash)`, `updateDefaultCurrency(currency)`.

### 1.3 Excepciones de dominio

**Archivo:** `domain/exceptions/user.exceptions.ts`

Clases que extienden `Error`, no `HttpException`. El mapeo a HTTP ocurre en infrastructure.

- `UserNotFoundException`
- `UserAlreadyExistsException`
- `InvalidCredentialsException`

### 1.4 Interface `IUserRepository`

**Archivo:** `domain/repositories/user.repository.ts`

Puerto de salida. Define el contrato sin implementación. Métodos:

- `findById(id: string): Promise<User | null>`
- `findByEmail(email: string): Promise<User | null>`
- `save(user: User): Promise<User>`
- `delete(id: string): Promise<void>`

---

## Paso 2 — Capa application

### 2.1 `CreateUserUseCase`

**Archivo:** `application/use-cases/create-user.use-case.ts`

1. Verifica que el email no esté en uso via `IUserRepository.findByEmail`
2. Lanza `UserAlreadyExistsException` si existe
3. Hashea el password con bcrypt
4. Crea la entidad con `User.create()`
5. Persiste via `IUserRepository.save()`
6. Retorna el usuario creado

### 2.2 `GetUserByIdUseCase`

**Archivo:** `application/use-cases/get-user-by-id.use-case.ts`

1. Busca via `IUserRepository.findById`
2. Lanza `UserNotFoundException` si no existe
3. Retorna el usuario

### 2.3 `GetUserByEmailUseCase`

**Archivo:** `application/use-cases/get-user-by-email.use-case.ts`

Uso interno para el módulo `auth`. Misma lógica que `GetUserById` pero por email. No se expone como endpoint HTTP.

### 2.4 `UpdateUserProfileUseCase`

**Archivo:** `application/use-cases/update-user-profile.use-case.ts`

1. Recupera el usuario via `GetUserByIdUseCase`
2. Llama a `user.updateProfile(name)`
3. Persiste via `IUserRepository.save()`

### 2.5 `UpdateDefaultCurrencyUseCase`

**Archivo:** `application/use-cases/update-default-currency.use-case.ts`

1. Recupera el usuario
2. Llama a `user.updateDefaultCurrency(currency)`
3. Persiste los cambios

### 2.6 `DeleteUserUseCase`

**Archivo:** `application/use-cases/delete-user.use-case.ts`

1. Verifica que el usuario existe
2. Elimina via `IUserRepository.delete()`

---

## Paso 3 — Capa infrastructure

### 3.1 `UserOrmEntity`

**Archivo:** `infrastructure/persistence/user.orm-entity.ts`

Entidad TypeORM con decoradores `@Entity`, `@Column`, `@PrimaryGeneratedColumn`, etc. Completamente separada de la entidad de dominio.

### 3.2 `UserMapper`

**Archivo:** `infrastructure/mappers/user.mapper.ts`

Convierte entre las dos representaciones:

- `toDomain(orm: UserOrmEntity): User` — usa `User.reconstitute()`
- `toOrm(domain: User): UserOrmEntity`

### 3.3 `UserRepositoryImpl`

**Archivo:** `infrastructure/persistence/user.repository.impl.ts`

Implementa `IUserRepository` usando el repositorio de TypeORM. Usa `UserMapper` en cada operación para convertir entre capas.

### 3.4 DTOs

**Archivos:** `infrastructure/http/dto/`

- `CreateUserDto` — email, password, name con validaciones de `class-validator`
- `UpdateUserProfileDto` — name opcional, extiende `PartialType`
- `UpdateDefaultCurrencyDto` — currency con `@IsEnum`
- `UserResponseDto` — excluye `passwordHash`, incluye id, email, name, createdAt

### 3.5 `UsersController`

**Archivo:** `infrastructure/http/controllers/users.controller.ts`

| Método | Ruta                  | Use case                       |
| ------ | --------------------- | ------------------------------ |
| POST   | `/users`              | `CreateUserUseCase`            |
| GET    | `/users/:id`          | `GetUserByIdUseCase`           |
| PATCH  | `/users/:id/profile`  | `UpdateUserProfileUseCase`     |
| PATCH  | `/users/:id/currency` | `UpdateDefaultCurrencyUseCase` |
| DELETE | `/users/:id`          | `DeleteUserUseCase`            |

Cada handler mapea la excepción de dominio a su equivalente HTTP correspondiente.

---

## Paso 4 — Wiring

### 4.1 `UsersModule`

**Archivo:** `users.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([UserOrmEntity])],
  controllers: [UsersController],
  providers: [
    // use cases
    CreateUserUseCase,
    GetUserByIdUseCase,
    GetUserByEmailUseCase,
    UpdateUserProfileUseCase,
    UpdateDefaultCurrencyUseCase,
    DeleteUserUseCase,
    // vincula la interface con su implementación
    {
      provide: IUserRepository,
      useClass: UserRepositoryImpl,
    },
  ],
  exports: [GetUserByEmailUseCase], // exportado para el módulo auth
})
export class UsersModule {}
```

### 4.2 Registrar en `AppModule`

Importar `UsersModule` en `app.module.ts` y asegurar que `TypeOrmModule.forRoot()` incluya `UserOrmEntity` en el array de entidades.

---

## Paso 5 — Verificación

- [ ] `POST /users` crea un usuario y retorna el `UserResponseDto` sin `passwordHash`
- [ ] `POST /users` con email duplicado retorna `409 Conflict`
- [ ] `GET /users/:id` retorna el usuario
- [ ] `GET /users/:id` con id inexistente retorna `404 Not Found`
- [ ] `PATCH /users/:id/profile` actualiza el nombre
- [ ] `DELETE /users/:id` elimina el usuario
- [ ] El módulo `auth` puede importar `GetUserByEmailUseCase` sin errores
