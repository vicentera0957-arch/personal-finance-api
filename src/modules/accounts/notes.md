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
| `UpdateAccountBalanceUseCase` | Recupera cuenta → aplica inflow/outflow via VO → persiste con QueryRunner opcional (atómico) |

### `UpdateAccountBalanceUseCase` — Herramienta standalone

**Archivo:** `application/use-cases/update-account-balance.use-case.ts`

Use case que modifica el balance de una cuenta de forma independiente. Recibe:
- `accountId: string` — id de la cuenta a modificar
- `amount: number` — monto positivo a aplicar
- `type: 'inflow' | 'outflow'` — operación a realizar
- `queryRunner?: QueryRunner` — parámetro opcional para participar en una transacción de BD externa

**Flujo:**
1. Recupera la cuenta via `IAccountRepository.findById(accountId)` — lanza `AccountNotFoundException` si no existe
2. Crea un VO `Balance` con el monto (valida via `Balance.create()`)
3. Llama `account.inflow()` o `account.outflow()` según el tipo
4. Persiste la cuenta modificada via `IAccountRepository.save(account, queryRunner)`

**Estado en V1:** Disponible como herramienta de uso futuro — no es consumido por el módulo `transactions`.
Los use cases de transacciones gestionan las mutaciones de balance directamente sobre la entidad `Account`
cargada en memoria, para mantener cohesión de la operación y evitar cargas redundantes a la DB.

> **Para cuándo sirve:** ajustes manuales de balance (correcciones administrativas, reconciliaciones),
> operaciones batch que necesiten modificar balances sin registrar una transacción contable.

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
    UpdateAccountBalanceUseCase,
    { provide: IAccountRepository, useClass: AccountRepositoryImpl },
  ],
  exports: [
    GetAccountByIdUseCase,        // consumido por el módulo transactions
    GetAccountsByUserIdUseCase,   // consumido por el módulo transactions
    UpdateAccountBalanceUseCase,  // disponible para módulos futuros (ajustes, reconciliaciones)
    IAccountRepository,           // consumido por el módulo transactions para saves atómicos
  ],
})
export class AccountsModule {}
```

---

## Consideraciones arquitectónicas

### `UpdateAccountBalanceUseCase` — Herramienta futura, no dependencia interna

El use case `UpdateAccountBalanceUseCase` existe en V1 pero **no es consumido por el módulo `transactions`**. Está disponible para casos de uso futuros que necesiten mutar el balance de forma aislada:

- **Ajustes manuales:** Correcciones administrativas por auditoría o errores en datos históricos
- **Reconciliación:** Sincronizar balance con banco externo
- **Cálculo de intereses:** Acumular intereses sin crear transacciones contables
- **Operaciones batch:** Actualizar balances de múltiples cuentas bajo criterios específicos

**Por qué no se usa en `CreateTransactionUseCase`:**

La decisión de mantener la lógica de inflow/outflow inline en CreateTransaction responde a estos principios:

1. **Cohesión operacional:** Registrar una transacción y actualizar el balance son inseparables en el dominio — son la misma operación de negocio
2. **Eficiencia:** La cuenta se carga una sola vez y se muta en memoria, evitando un segundo query a la BD
3. **Simplicidad:** Abstraer innecesariamente añade complejidad (N+1, indirección) sin beneficio claro aún
4. **Claridad del flujo:** El lector ve exactamente qué pasa: load → mutate → persist, todo en un use case

**Cuándo usarías `UpdateAccountBalanceUseCase`:**

```typescript
// Escenario: ajustar balance por auditoría (módulo futuro de corrections)
const correctionUseCase = new ApplyBalanceCorrectionUseCase(
  updateAccountBalanceUseCase,  // ← lo inyectaría como dependencia
  correctionRepository,
);

await correctionUseCase.execute({
  accountId: '123',
  reason: 'Auditoría: reversión de transacción duplicada',
  adjustment: -500,  // outflow
});
```

En ese contexto, el use case es la herramienta correcta porque la operación está por sí sola desacoplada de la contabilidad normal.

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
