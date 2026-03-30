# Módulo `accounts` — Documentación de referencia

## Alcance V1

| Incluido | Excluido |
| -------- | -------- |
| Crear cuenta con nombre, tipo y balance inicial | Transferencias entre cuentas (módulo `transactions`) |
| Recuperar cuenta por id | Actualización de balance vía transacciones |
| Listar cuentas de un usuario | `AdjustBalance` manual (ver decisión más abajo) |
| Renombrar cuenta | Paginación del listado |
| Archivar / desarchivar cuenta | |
| Eliminar cuenta | |

---

## Capa domain

### Value object `Balance`

**Archivo:** `domain/value-objects/balance.vo.ts`

Clase inmutable que encapsula un monto monetario en **CLP** (sin decimales). Relación 1:1 entre el valor del VO y lo que se persiste en la DB.

Métodos:
- `Balance.create(amount)` — valida que sea número finito, no negativo y sin decimales; rechaza decimales explícitamente (CLP no tiene centavos)
- `Balance.reconstitute(value)` — reconstruye desde persistencia sin re-validar; evita que cambios futuros en las reglas rompan datos históricos
- `Balance.zero()` — factory para balance cero
- `add(other)` — aritmética inmutable, retorna nuevo `Balance`
- `subtract(other)` — aritmética inmutable; lanza `InsufficientFundsException` si el resultado sería negativo
- `getValue()`, `equals()`, `greaterThan()`, `isZero()`

**Por qué no usar centavos:** CLP no tiene centavos, almacenar en centavos solo añade conversión sin beneficio. Si en el futuro se soportan otras monedas (USD, EUR), habrá que migrar la columna a `decimal(15,2)` y revisar el VO.

**Por qué `add`/`subtract` viven en el VO:** La regla "un balance no puede ser negativo" pertenece al VO. Si esa validación viviera en `Account` o en `transactions`, habría que repetirla en cada lugar que modifique un balance. En el VO, es imposible construir un `Balance` inválido sin importar desde dónde se llame.

### Value object `AccountType`

**Archivo:** `domain/value-objects/type.vo.ts`

Clase inmutable que valida el tipo de cuenta contra una lista cerrada. El valor se normaliza a minúsculas.

Tipos válidos: `ahorro`, `corriente`, `vista`, `ruta`, `otros`

Métodos:
- `AccountType.create(tipo)` — valida contra la lista; lanza `NoTypeProvidedException` si está vacío o `InvalidAccountTypeException` si el tipo no es válido
- `AccountType.reconstitute(tipo)` — reconstruye desde persistencia sin re-validar
- `getType()`, `equals()`

### Entidad `Account`

**Archivo:** `domain/entities/account.entity.ts`

Clase pura sin decoradores. Constructor privado con dos factory methods:

- `Account.create(props)` — para cuentas nuevas; `currentBalance` arranca igual a `initialBalance`; `isArchived` arranca en `false`
- `Account.reconstitute(props)` — para reconstruir desde persistencia; acepta `currentBalance` independiente del inicial

Métodos de negocio:

| Método | Descripción |
| ------ | ----------- |
| `inflow(amount)` | Suma al balance; bloquea si archivada |
| `outflow(amount)` | Resta al balance; bloquea si archivada; delega en `Balance.subtract` para validar fondos |
| `hasSufficientFunds(amount)` | Consulta de solo lectura; siempre disponible |
| `rename(name)` | Renombra; bloquea si archivada |
| `archive()` | Archiva; lanza error si ya está archivada |
| `unarchive()` | Desarchiva; lanza error si no está archivada |

### Invariante: cuentas archivadas son inmutables

Una cuenta archivada no puede modificar su balance ni su nombre. El usuario debe llamar `unarchive()` explícitamente antes de volver a operar.

| Método | Excepción si archivada |
| ------ | ---------------------- |
| `inflow(amount)` | `CannotOperateOnArchivedAccountException` |
| `outflow(amount)` | `CannotOperateOnArchivedAccountException` |
| `rename(name)` | `CannotOperateOnArchivedAccountException` |

### Excepciones de dominio

**Archivo:** `domain/exceptions/account.exceptions.ts`

Todas extienden la clase base `AccountException extends Error`. El mapeo a HTTP ocurre exclusivamente en el controlador.

**Excepciones de entidad:**
| Excepción | Cuándo se lanza |
| --------- | --------------- |
| `AccountNotFoundException` | Cuenta no encontrada por id |
| `AccountAlreadyArchivedDomainException` | `archive()` sobre cuenta ya archivada |
| `AccountNotArchivedDomainException` | `unarchive()` sobre cuenta no archivada |
| `CannotOperateOnArchivedAccountException` | `inflow`, `outflow`, `rename` sobre cuenta archivada |
| `ZeroAmountInflowException` | `inflow()` con monto cero |
| `ZeroAmountOutflowException` | `outflow()` con monto cero |
| `InvalidAccountNameException` | `rename()` con nombre vacío |

**Excepciones de Value Object:**
| Excepción | Cuándo se lanza |
| --------- | --------------- |
| `InsufficientFundsException` | `Balance.subtract()` cuando el resultado sería negativo |
| `InvalidBalanceException` | `Balance.create()` con valor inválido (no finito, negativo, o decimal) |
| `NoTypeProvidedException` | `AccountType.create()` con string vacío |
| `InvalidAccountTypeException` | `AccountType.create()` con tipo no reconocido |

### Repositorio

**Archivo:** `domain/repository/accounts.repository.ts`

Puerto de salida definido como clase abstracta. Métodos:

- `findById(id: string): Promise<Account | null>`
- `findByUserId(userId: string): Promise<Account[]>`
- `save(account: Account): Promise<Account>`
- `delete(id: string): Promise<void>`

---

## Capa application

### Use cases

| Use case | Descripción |
| -------- | ----------- |
| `CreateAccountUseCase` | Crea VOs `AccountType` y `Balance` → crea entidad → persiste |
| `GetAccountByIdUseCase` | Busca por id → lanza `AccountNotFoundException` si no existe |
| `GetAccountsByUserIdUseCase` | Retorna array (vacío es válido, no es error) |
| `RenameAccountUseCase` | Recupera cuenta → llama `account.rename()` → persiste |
| `ArchiveAccountUseCase` | Recupera cuenta → llama `account.archive()` → persiste |
| `UnarchiveAccountUseCase` | Recupera cuenta → llama `account.unarchive()` → persiste |
| `DeleteAccountUseCase` | Verifica existencia → elimina → retorna `void` |

---

## Capa infrastructure

### `AccountOrmEntity`

**Archivo:** `infrastructure/persistance/account.orm.entity.ts`

| Columna | Tipo | Notas |
| ------- | ---- | ----- |
| `id` | `uuid` | PK, generado en el use case con `randomUUID()` |
| `userId` | `varchar` | Referencia lógica al usuario (sin FK por ahora) |
| `name` | `varchar` | |
| `type` | `varchar` | Almacena el string del VO `AccountType` |
| `initialBalance` | `int` | Valor directo en CLP (1:1 con el VO) |
| `currentBalance` | `int` | Valor directo en CLP (1:1 con el VO) |
| `isArchived` | `boolean` | Default `false` |
| `created_at` | `timestamp` | `@Column` simple — el dominio controla este valor |
| `updated_at` | `timestamp` | `@Column` simple — el dominio controla este valor |

### `AccountMapper`

**Archivo:** `infrastructure/persistance/account.mapper.ts`

Único punto de traducción entre ORM entity y domain entity.

- `toDomain(orm)` — usa `Balance.reconstitute()` y `AccountType.reconstitute()` para no re-validar datos persistidos; usa `Account.reconstitute()`
- `toOrm(domain)` — extrae valores con getters del dominio

### `AccountRepositoryImpl`

**Archivo:** `infrastructure/persistance/account.repo.implement.ts`

Implementa `IAccountRepository` con TypeORM. Delega toda la conversión al mapper.

### DTOs

**Archivos:** `infrastructure/http/dto/`

- `CreateAccountDto` — `userId`, `name`, `type`, `initialBalance` con validaciones de `class-validator`
- `RenameAccountDto` — `name`
- `AccountResponseDto` — `id`, `userId`, `name`, `type`, `initialBalance`, `currentBalance`, `isArchived`, `createdAt`, `updatedAt`

### `AccountsController`

**Archivo:** `infrastructure/http/accounts-controller/accounts.controller.ts`

| Método | Ruta | Use case | HTTP éxito |
| ------ | ---- | -------- | ---------- |
| POST | `/accounts` | `CreateAccountUseCase` | 201 |
| GET | `/accounts/:id` | `GetAccountByIdUseCase` | 200 |
| GET | `/accounts/user/:userId` | `GetAccountsByUserIdUseCase` | 200 |
| PATCH | `/accounts/:id/name` | `RenameAccountUseCase` | 200 |
| PATCH | `/accounts/:id/archive` | `ArchiveAccountUseCase` | 200 |
| PATCH | `/accounts/:id/unarchive` | `UnarchiveAccountUseCase` | 200 |
| DELETE | `/accounts/:id` | `DeleteAccountUseCase` | 204 |

Mapeo de excepciones de dominio a HTTP:

| Excepción | HTTP |
| --------- | ---- |
| `AccountNotFoundException` | 404 |
| `AccountAlreadyArchivedDomainException` | 409 |
| `AccountNotArchivedDomainException` | 409 |
| `CannotOperateOnArchivedAccountException` | 409 |
| `InvalidBalanceException` | 400 |
| `NoTypeProvidedException` | 400 |
| `InvalidAccountTypeException` | 400 |
| `InsufficientFundsException` | 422 |

---

## Wiring — `AccountsModule`

**Archivo:** `accounts.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([AccountOrmEntity])],
  controllers: [AccountsController],
  providers: [
    AccountMapper,
    CreateAccountUseCase,
    GetAccountByIdUseCase,
    GetAccountsByUserIdUseCase,
    RenameAccountUseCase,
    ArchiveAccountUseCase,
    UnarchiveAccountUseCase,
    DeleteAccountUseCase,
    { provide: IAccountRepository, useClass: AccountRepositoryImpl },
  ],
  exports: [GetAccountByIdUseCase], // consumido por el módulo transactions
})
export class AccountsModule {}
```

---

## Decisiones de diseño

### `adjustBalance` y `resetToInitialBalance` no implementados en V1

Ambos métodos fueron removidos de la entidad porque manipulan el balance directamente sin dejar registro del motivo. `adjustBalance` validaba un `reason` pero lo descartaba sin persistirlo — falsa trazabilidad. Para reimplementarlos en V2 debe existir primero:
- Un módulo de auditoría que persista operaciones manuales con motivo y actor, o
- Eventos de dominio (`BalanceAdjusted`) que otro módulo consuma y persista

### `reconstitute()` en todos los VOs

Todos los VOs tienen un método `reconstitute()` separado de `create()`. El mapper siempre usa `reconstitute()` al leer desde la DB para evitar re-validar datos ya persistidos. Si las reglas de validación cambian en el futuro, los datos históricos no se rompen al ser leídos.

---

## Checklist de verificación

- [ ] `POST /accounts` crea cuenta y retorna `AccountResponseDto`
- [ ] `POST /accounts` con tipo inválido → `400 Bad Request`
- [ ] `POST /accounts` con balance negativo → `400 Bad Request`
- [ ] `GET /accounts/:id` retorna la cuenta
- [ ] `GET /accounts/:id` con id inexistente → `404 Not Found`
- [ ] `GET /accounts/user/:userId` retorna array de cuentas del usuario
- [ ] `GET /accounts/user/:userId` sin cuentas → array vacío `[]`
- [ ] `PATCH /accounts/:id/name` actualiza el nombre
- [ ] `PATCH /accounts/:id/name` sobre cuenta archivada → `409 Conflict`
- [ ] `PATCH /accounts/:id/archive` archiva la cuenta
- [ ] `PATCH /accounts/:id/archive` sobre cuenta ya archivada → `409 Conflict`
- [ ] `PATCH /accounts/:id/unarchive` desarchiva la cuenta
- [ ] `PATCH /accounts/:id/unarchive` sobre cuenta no archivada → `409 Conflict`
- [ ] `DELETE /accounts/:id` elimina la cuenta → `204 No Content`
- [ ] `DELETE /accounts/:id` con id inexistente → `404 Not Found`
- [ ] El módulo `transactions` puede importar `GetAccountByIdUseCase` sin errores
