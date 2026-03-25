# Implementación de la feature `accounts`

---

## Paso 0 — Definir el alcance

Antes de escribir una sola línea de código, documentar qué hace y qué no hace esta feature en V1.

### Casos de uso — V1

- `CreateAccount` — crear una cuenta con nombre, tipo y balance inicial
- `GetAccountById` — recuperar una cuenta por su id
- `GetAccountsByUserId` — listar todas las cuentas de un usuario
- `RenameAccount` — renombrar una cuenta existente
- `ArchiveAccount` — archivar una cuenta (no se elimina, se desactiva)
- `DeleteAccount` — eliminar una cuenta permanentemente

### Casos de uso — fuera de scope en V1

- Transferencias entre cuentas (pertenece al módulo `transactions`)
- Actualización de balance vía transacciones (`inflow`/`outflow` se disparan desde `transactions`)
- `AdjustBalance` manual (útil para correcciones, se deja para V2)
- `UnarchiveAccount` (restaurar una cuenta archivada, se deja para V2)
- Paginación del listado de cuentas

### Resultado esperado

Un slice vertical completo: desde la base de datos hasta la respuesta HTTP, pasando por use cases y el repositorio concreto.

---

## Paso 1 — Capa domain ✅ (ya implementada)

Esta capa está completamente implementada. Se documenta aquí como referencia para las capas siguientes.

1.1 value objects:
. Balance
. Type

### 1.1 Value object `Balance`

**Archivo:** `domain/value-objects/balance.vo.ts`

Clase inmutable que encapsula un monto monetario en **CLP** (peso chileno, sin decimales). Relación 1:1 entre el valor del VO y lo que se persiste en la DB — sin conversión de centavos. Métodos clave:

- `Balance.create(amount)` — valida que sea número finito y no negativo; aplica `Math.round` para descartar decimales accidentales
- `Balance.reconstitute(value)` — reconstruye desde persistencia sin validación extra
- `Balance.zero()` — factory para balance cero
- `add(other)`, `subtract(other)` — aritmética inmutable; `subtract` lanza error si el resultado sería negativo
- `getValue()` — devuelve el valor directo, que es exactamente lo que se almacena en la DB

> **Por qué `add` y `subtract` viven aquí y no en `transactions`:**
> El principio DDD aplicado es _encapsulación de invariantes en el Value Object_. La regla "un balance no puede ser negativo" le pertenece al VO, no al módulo que decide cuándo operar. Si esa validación viviera en `Account` o en `transactions`, habría que repetirla en cada lugar que modifique un balance, y sería posible construir un `Balance(-100)` desde cualquier rincón del sistema. Al ponerla en el VO, es imposible tener un `Balance` inválido sin importar desde dónde se llame.

Por que decidi quitar cents:
CLP no tiene centavos, así que almacenar en centavos solo  
 añadiría una capa de conversión sin ningún beneficio real. La relación 1:1 hace el código más predecible y el
mapper más simple.

El único riesgo que hay que tener en mente es si en el futuro el sistema necesita soportar otras monedas que  
 sí usan decimales (USD, EUR). En ese caso habría que migrar la columna de int a algo como decimal(15,2) y  
 revisar el VO. Pero para una V1 en CLP creo es la decisión correcta.

### 1.2 Value object `AccountType`

**Archivo:** `domain/value-objects/type.vo.ts`

Clase inmutable que valida el tipo de cuenta contra una lista cerrada: `ahorro`, `corriente`, `vista`, `ruta`, `otros`. El valor se normaliza a minúsculas al crearse.

### 1.3 Entidad `Account`

**Archivo:** `domain/entities/account.entity.ts`
He tenido dudas con respecto a dejar algunas validaciones dentro del cosntructor, las deje sin validaciones confiando en el patron de factory methods
Clase pura sin decoradores. Constructor privado con dos factory methods:

- `Account.create(props)` — para cuentas nuevas; `currentBalance` arranca igual a `initialBalance`
- `Account.reconstitute(props)` — para reconstruir desde persistencia; acepta `currentBalance` independiente

Métodos de negocio disponibles: `inflow(amount)`, `outflow(amount)`, `hasSufficientFunds(amount)`, `adjustBalance(newBalance, reason)`, `resetToInitialBalance()`, `rename(name)`, `archive()`, `unarchive()`.

### 1.4 Excepciones de dominio

**Archivo:** `domain/exceptions/account.exceptions.ts`

Clases que extienden la base `AccountException extends Error`, no `HttpException`. El mapeo a HTTP ocurre en el controlador.

- `AccountNotFoundException` — cuenta no encontrada por id
- `InsufficientFundsException` — fondos insuficientes para una operación
- `AccountArchivedException` — operación rechazada porque la cuenta está archivada

### 1.5 Interface `IAccountRepository`

**Archivo:** `domain/repository/accounts.repository.ts`

Puerto de salida definido como clase abstracta (necesario para que NestJS lo use como token de DI). Métodos:

- `findById(id: string): Promise<Account | null>`
- `findByUserId(userId: string): Promise<Account[]>`
- `save(account: Account): Promise<Account>`
- `delete(id: string): Promise<void>`

## Revise el dom, y deje como pendiente revisar el detalle de si verificar agregar validaciones dentro del constructor en la entity. Aun asi todo va bien.

## Paso 2 — Capa application

### 2.1 `CreateAccountUseCase`

**Archivo:** `application/use-cases/create-account.use-case.ts`

1. Crea el VO `AccountType` con el tipo recibido — lanza error de dominio si el tipo no es válido
2. Crea el VO `Balance` con el balance inicial
3. Crea la entidad con `Account.create()`
4. Persiste via `IAccountRepository.save()`
5. Retorna la cuenta creada

### 2.2 `GetAccountByIdUseCase`

**Archivo:** `application/use-cases/get-account-by-id.use-case.ts`

1. Busca via `IAccountRepository.findById`
2. Lanza `AccountNotFoundException` si no existe
3. Retorna la cuenta

### 2.3 `GetAccountsByUserIdUseCase`

**Archivo:** `application/use-cases/get-accounts-by-user-id.use-case.ts`

1. Busca via `IAccountRepository.findByUserId`
2. Retorna el array (puede ser vacío — no es un error)

### 2.4 `RenameAccountUseCase`

**Archivo:** `application/use-cases/rename-account.use-case.ts`

1. Recupera la cuenta via `GetAccountByIdUseCase`
2. Verifica que la cuenta no esté archivada — lanza `AccountArchivedException` si lo está
3. Llama a `account.rename(name)`
4. Persiste via `IAccountRepository.save()`
5. Retorna la cuenta actualizada

### 2.5 `ArchiveAccountUseCase`

**Archivo:** `application/use-cases/archive-account.use-case.ts`

1. Recupera la cuenta via `GetAccountByIdUseCase`
2. Llama a `account.archive()` — la entidad lanza error si ya está archivada
3. Persiste via `IAccountRepository.save()`
4. Retorna la cuenta actualizada

### 2.6 `DeleteAccountUseCase`

**Archivo:** `application/use-cases/delete-account.use-case.ts`

1. Verifica que la cuenta existe via `GetAccountByIdUseCase`
2. Elimina via `IAccountRepository.delete()`

---

## Paso 3 — Capa infrastructure

### 3.1 `AccountOrmEntity`

**Archivo:** `infrastructure/persistence/account.orm.entity.ts`

Entidad TypeORM completamente separada de la entidad de dominio. Columnas:

| Columna          | Tipo        | Notas                                            |
| ---------------- | ----------- | ------------------------------------------------ |
| `id`             | `uuid`      | PK, generado fuera de TypeORM (en el use case)   |
| `userId`         | `varchar`   | Referencia lógica al usuario (sin FK por ahora)  |
| `name`           | `varchar`   |                                                  |
| `type`           | `varchar`   | Almacena el string del VO `AccountType`          |
| `initialBalance` | `int`       | Almacena el valor directo en CLP (1:1 con el VO) |
| `currentBalance` | `int`       | Almacena el valor directo en CLP (1:1 con el VO) |
| `isArchived`     | `boolean`   | Default `false`                                  |
| `createdAt`      | `timestamp` |                                                  |
| `updatedAt`      | `timestamp` |                                                  |

### 3.2 `AccountMapper`

**Archivo:** `infrastructure/persistence/account.mapper.ts`

Convierte entre las dos representaciones. Es el único lugar que conoce ambas capas:

- `toDomain(orm: AccountOrmEntity): Account` — usa `Balance.reconstitute(value)` para los balances y `AccountType.create(tipo)` para el tipo; usa `Account.reconstitute()`
- `toOrm(domain: Account): AccountOrmEntity` — usa `getValue()` para los balances y `getType()` para el tipo

### 3.3 `AccountRepositoryImpl`

**Archivo:** `infrastructure/persistence/account.repo.implement.ts`

Implementa `IAccountRepository` usando el repositorio de TypeORM. Usa `AccountMapper` en cada operación para convertir entre capas. Extiende `IAccountRepository` (clase abstracta) e inyecta el `Repository<AccountOrmEntity>` de TypeORM.

### 3.4 DTOs

**Archivos:** `infrastructure/http/dto/`

- `CreateAccountDto` — `userId: string`, `name: string`, `type: string`, `initialBalance: number` con validaciones de `class-validator`
- `RenameAccountDto` — `name: string`
- `AccountResponseDto` — `id`, `userId`, `name`, `type`, `initialBalance`, `currentBalance`, `isArchived`, `createdAt`, `updatedAt`. Excluye cualquier detalle interno de los VOs.

### 3.5 `AccountsController`

**Archivo:** `infrastructure/http/controllers/accounts.controller.ts`

| Método | Ruta                     | Use case                     | HTTP success |
| ------ | ------------------------ | ---------------------------- | ------------ |
| POST   | `/accounts`              | `CreateAccountUseCase`       | 201          |
| GET    | `/accounts/:id`          | `GetAccountByIdUseCase`      | 200          |
| GET    | `/accounts/user/:userId` | `GetAccountsByUserIdUseCase` | 200          |
| PATCH  | `/accounts/:id/rename`   | `RenameAccountUseCase`       | 200          |
| PATCH  | `/accounts/:id/archive`  | `ArchiveAccountUseCase`      | 200          |
| DELETE | `/accounts/:id`          | `DeleteAccountUseCase`       | 204          |

Cada handler atrapa las excepciones de dominio y las traduce a su equivalente HTTP:

| Excepción de dominio         | HTTP |
| ---------------------------- | ---- |
| `AccountNotFoundException`   | 404  |
| `AccountArchivedException`   | 409  |
| `InsufficientFundsException` | 422  |

---

## Paso 4 — Wiring

### 4.1 `AccountsModule`

**Archivo:** `accounts.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([AccountOrmEntity])],
  controllers: [AccountsController],
  providers: [
    // Mapper
    AccountMapper,

    // Use Cases
    CreateAccountUseCase,
    GetAccountByIdUseCase,
    GetAccountsByUserIdUseCase,
    RenameAccountUseCase,
    ArchiveAccountUseCase,
    DeleteAccountUseCase,

    // Vincula la interfaz con su implementación
    {
      provide: IAccountRepository,
      useClass: AccountRepositoryImpl,
    },
  ],
  exports: [GetAccountByIdUseCase], // exportado para el módulo transactions
})
export class AccountsModule {}
```

### 4.2 Registrar en `AppModule`

Importar `AccountsModule` en `app.module.ts` y asegurar que `TypeOrmModule.forRoot()` incluya `AccountOrmEntity` en el array de entidades.

---

## Paso 5 — Verificación

- [ ] `POST /accounts` crea una cuenta y retorna el `AccountResponseDto`
- [ ] `POST /accounts` con tipo inválido retorna `400 Bad Request`
- [ ] `POST /accounts` con balance inicial negativo retorna `400 Bad Request`
- [ ] `GET /accounts/:id` retorna la cuenta correcta
- [ ] `GET /accounts/:id` con id inexistente retorna `404 Not Found`
- [ ] `GET /accounts/user/:userId` retorna el array de cuentas del usuario
- [ ] `GET /accounts/user/:userId` sin cuentas retorna array vacío `[]`
- [ ] `PATCH /accounts/:id/rename` actualiza el nombre y retorna la cuenta
- [ ] `PATCH /accounts/:id/rename` sobre cuenta archivada retorna `409 Conflict`
- [ ] `PATCH /accounts/:id/archive` archiva la cuenta
- [ ] `PATCH /accounts/:id/archive` sobre cuenta ya archivada retorna `409 Conflict`
- [ ] `DELETE /accounts/:id` elimina la cuenta y retorna `204 No Content`
- [ ] `DELETE /accounts/:id` con id inexistente retorna `404 Not Found`
- [ ] El módulo `transactions` puede importar `GetAccountByIdUseCase` sin errores
