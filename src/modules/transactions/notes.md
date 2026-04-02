# Implementación de la feature `transactions`

---

## Paso 0 — Definir el alcance

### Casos de uso — V1

- `CreateTransaction` — registrar un ingreso o gasto que afecta el balance de una cuenta
- `GetTransactionById` — recuperar una transacción por id
- `GetTransactionsByAccountId` — listar transacciones de una cuenta
- `GetTransactionsByUserId` — listar todas las transacciones de un usuario
- `DeleteTransaction` — eliminar una transacción y revertir su efecto en el balance

### Casos de uso — fuera de scope en V1

- Editar una transacción (requiere revertir el balance viejo y aplicar el nuevo — V2)
- Transferencias entre cuentas (tabla `transfers` separada — módulo propio en V2)
- Filtros/paginación/búsqueda por fecha, categoría, etc.
- Transacciones recurrentes
- Adjuntos/comprobantes

### Resultado esperado

Un slice vertical completo que integra los módulos `accounts` y `categories`. Cada transacción creada actualiza el balance de la cuenta asociada. Cada transacción eliminada revierte ese efecto. El módulo valida en el use case que la naturaleza de la categoría sea compatible con la de la transacción (R7).

---

## Paso 1 — Capa domain

### 1.1 Value object `TransactionNature`

**Archivo:** `domain/value-objects/transaction-nature.vo.ts`

Clase inmutable con dos valores válidos: `income` | `expense`. Sigue el mismo patrón que `CategoryNature` y `AccountType`. No incluye `transfer` porque las transferencias son una entidad separada según el esquema de BD.

> **Decisión: VO duplicado vs. VO compartido con categories**
> `CategoryNature` y `TransactionNature` tienen los mismos valores posibles. La opción de compartir un VO entre módulos ahorraría código, pero acopla dos bounded contexts distintos. En DDD es preferible la duplicación ligera antes que la dependencia entre dominios. Si el día de mañana las categorías necesitan un tipo `transfer` pero las transacciones no, el acoplamiento se convertiría en un problema. Con VOs separados, cada módulo evoluciona independientemente.

### 1.2 Value object `Amount`

**Archivo:** `domain/value-objects/amount.vo.ts`

Clase inmutable que encapsula el monto de una transacción en CLP. Validaciones: número finito, entero, estrictamente mayor que cero (R4: el monto debe ser positivo).

> **Decisión: VO propio en vez de reutilizar `Balance` de accounts**
> `Balance` pertenece al dominio de `accounts` y representa el saldo acumulado de una cuenta. `Amount` representa el monto puntual de una transacción. Son conceptos distintos aunque compartan la representación en CLP. Además:
> - `Balance` permite cero (`Balance.zero()`) — un balance puede ser cero; un monto de transacción no
> - `Amount` refuerza `amount > 0` (R4), mientras que `Balance` permite `amount >= 0`
> - Mantener VOs separados evita que el módulo `transactions` importe del dominio de `accounts`
>
> En el use case, la conversión de `Amount` a `Balance` se hace explícitamente con `Balance.create(amount.getValue())` antes de llamar a `account.inflow()` o `account.outflow()`.

### 1.3 Entidad `Transaction`

**Archivo:** `domain/entities/transaction.entity.ts`

Clase pura sin decoradores. Constructor privado con dos factory methods:

- `Transaction.create(props)` — para transacciones nuevas; genera `createdAt`
- `Transaction.reconstitute(props)` — para reconstruir desde persistencia

Propiedades: `id`, `userId`, `accountId`, `categoryId`, `nature` (tipo `TransactionNature`), `amount` (tipo `Amount`), `description` (opcional), `transactionDate`, `createdAt`.

> **Decisión: sin `updatedAt`**
> Consistente con el esquema de BD. Las transacciones son registros contables inmutables — no se "editan", se eliminan y recrían. No hay métodos de mutación en la entidad salvo los getters. Esto también es consistente con prácticas contables: un asiento no se borra, se contra-asienta. En V1 se permite el delete para simplicidad, pero la entidad refleja su naturaleza inmutable.

### 1.4 Excepciones de dominio

**Archivo:** `domain/exceptions/transaction.exceptions.ts`

- `TransactionNotFoundException` — transacción no encontrada por id
- `CannotDeleteTransactionException` — no se puede eliminar porque revertiría el balance a negativo

> **Decisión: `CannotDeleteTransactionException`**
> Al eliminar una transacción de tipo `income`, hay que hacer un `outflow` para revertirla. Pero si el balance actual de la cuenta es menor que el monto de esa transacción (porque se gastó ese dinero después), el `outflow` fallaría con un error genérico del VO. Capturar ese caso con una excepción específica permite dar un mensaje más claro al usuario: "No se puede eliminar esta transacción porque revertiría el balance de la cuenta a negativo."

### 1.5 Interface `ITransactionRepository`

**Archivo:** `domain/repository/transaction.repository.ts`

Puerto de salida como clase abstracta. Métodos:

- `findById(id: string): Promise<Transaction | null>`
- `findByAccountId(accountId: string): Promise<Transaction[]>`
- `findByUserId(userId: string): Promise<Transaction[]>`
- `save(transaction: Transaction): Promise<Transaction>`
- `delete(id: string): Promise<void>`

---

## Paso 2 — Capa application

### 2.1 `CreateTransactionUseCase`

**Archivo:** `application/use-cases/create-transaction.use-case.ts`

1. Crea el VO `TransactionNature` con la naturaleza recibida
2. Crea el VO `Amount` con el monto (valida que sea positivo)
3. Verifica que la cuenta existe via `GetAccountByIdUseCase` (importado de accounts)
4. Verifica que la categoría existe via `GetCategoryByIdUseCase` (importado de categories)
5. Valida que `category.getNature()` coincida con la naturaleza de la transacción (R7) — lanza error de dominio si no coincide
6. Crea la entidad `Transaction` con `Transaction.create()`
7. Aplica el efecto en el balance en memoria — sin tocar la DB todavía:
   - `income` → `account.inflow(Balance.create(amount.getValue()))`
   - `expense` → `account.outflow(Balance.create(amount.getValue()))` — puede lanzar `InsufficientFundsException` antes de abrir la transacción DB
8. Persiste cuenta + transacción de forma atómica via `DataSource.createQueryRunner()`
9. Retorna la transacción creada

> **Decisión: mutación en memoria antes del QueryRunner**
> El `outflow` se aplica sobre el objeto `account` en memoria antes de abrir la transacción de BD. Si hay fondos insuficientes, la excepción se lanza antes de crear el QueryRunner — sin costo de conexión a DB. Solo si la mutación en memoria tiene éxito, se abre la transacción y se persiste.

> **Decisión: importar `IAccountRepository` y `GetAccountByIdUseCase` del módulo accounts**
> El use case necesita tanto leer la cuenta (para validar existencia y obtener el objeto a mutar) como guardarla (después de modificar el balance). Se importa `GetAccountByIdUseCase` para la lectura (encapsula el 404) y `IAccountRepository` directamente para el save atómico con QueryRunner. El módulo `accounts` exporta ambos.

### 2.2 `GetTransactionByIdUseCase`

**Archivo:** `application/use-cases/get-transaction-by-id.use-case.ts`

1. Busca via `ITransactionRepository.findById`
2. Lanza `TransactionNotFoundException` si no existe
3. Retorna la transacción

### 2.3 `GetTransactionsByAccountIdUseCase`

**Archivo:** `application/use-cases/get-transactions-by-account-id.use-case.ts`

1. Busca via `ITransactionRepository.findByAccountId`
2. Retorna el array (puede ser vacío)

### 2.4 `GetTransactionsByUserIdUseCase`

**Archivo:** `application/use-cases/get-transactions-by-user-id.use-case.ts`

1. Busca via `ITransactionRepository.findByUserId`
2. Retorna el array (puede ser vacío)

### 2.5 `DeleteTransactionUseCase`

**Archivo:** `application/use-cases/delete-transaction.use-case.ts`

1. Recupera la transacción via `GetTransactionByIdUseCase`
2. Recupera la cuenta via `GetAccountByIdUseCase`
3. Intenta revertir el efecto en la cuenta en memoria — sin tocar la DB todavía:
   - Si era `income`: intenta `account.outflow(balance)` — puede fallar si el balance es insuficiente
   - Si era `expense`: hace `account.inflow(balance)` — siempre funciona (sumar nunca falla)
4. Si el outflow falla (balance insuficiente), lanza `CannotDeleteTransactionException`
5. Persiste la cuenta actualizada + elimina la transacción de forma atómica via `DataSource.createQueryRunner()`

> **Decisión: mutación en memoria antes del QueryRunner**
> Igual que en CreateTransaction, la validación de fondos ocurre sobre el objeto en memoria antes de abrir la transacción de BD. Solo si la reversión en memoria tiene éxito se incurre en el costo de la transacción de BD.

> **Decisión: `CannotDeleteTransactionException`**
> Si el usuario creó un income de $1000, gastó $800 después, intenta eliminar el income: el outflow reverso de $1000 fallaría con `InsufficientFundsException` (técnica). Se mapea a `CannotDeleteTransactionException` que es semánticamente clara para el usuario: "No se puede eliminar porque revertiría el balance a negativo."

---

## Paso 3 — Capa infrastructure

### 3.1 `TransactionOrmEntity`

**Archivo:** `infrastructure/persistence/transaction.orm.entity.ts`

Entidad TypeORM separada del dominio. Columnas:

| Columna           | Tipo        | Notas                                          |
| ----------------- | ----------- | ---------------------------------------------- |
| `id`              | `uuid`      | PK, generado fuera de TypeORM                  |
| `userId`          | `varchar`   | Referencia lógica al usuario                   |
| `accountId`       | `varchar`   | Referencia lógica a la cuenta                  |
| `categoryId`      | `varchar`   | Referencia lógica a la categoría               |
| `nature`          | `varchar`   | `income` o `expense`                           |
| `amount`          | `int`       | Monto en CLP (sin decimales, igual que Balance)|
| `description`     | `varchar`   | Nullable                                       |
| `transactionDate` | `timestamp` | Fecha del movimiento (puede diferir de createdAt) |
| `createdAt`       | `timestamp` | Fecha de registro en el sistema                |

> **Decisión: `transactionDate` separado de `createdAt`**
> En finanzas personales, el usuario puede registrar una transacción que ocurrió ayer o la semana pasada. `transactionDate` es la fecha real del movimiento; `createdAt` es cuándo se ingresó al sistema. Esta separación es fundamental para reportes y análisis por período.

### 3.2 `TransactionMapper`

**Archivo:** `infrastructure/persistence/transaction.mapper.ts`

- `toDomain(orm: TransactionOrmEntity): Transaction` — usa `TransactionNature.create()` y `Amount.create()` (con `reconstitute` para Amount para no re-validar); usa `Transaction.reconstitute()`
- `toOrm(domain: Transaction): TransactionOrmEntity` — extrae los valores primitivos de los VOs

### 3.3 `TransactionRepositoryImpl`

**Archivo:** `infrastructure/persistence/transaction.repo.implement.ts`

Implementa `ITransactionRepository` con TypeORM y `TransactionMapper`.

### 3.4 DTOs

**Archivos:** `infrastructure/http/dto/`

- `CreateTransactionDto` — `userId`, `accountId`, `categoryId`, `nature`, `amount`, `description?`, `transactionDate`
- `TransactionResponseDto` — todos los campos de la entidad con tipos planos

### 3.5 `TransactionsController`

**Archivo:** `infrastructure/http/transactions-controller/transactions.controller.ts`

| Método | Ruta                                | Use case                          | HTTP |
| ------ | ----------------------------------- | --------------------------------- | ---- |
| POST   | `/transactions`                     | `CreateTransactionUseCase`        | 201  |
| GET    | `/transactions/:id`                 | `GetTransactionByIdUseCase`       | 200  |
| GET    | `/transactions/account/:accountId`  | `GetTransactionsByAccountIdUseCase` | 200 |
| GET    | `/transactions/user/:userId`        | `GetTransactionsByUserIdUseCase`  | 200  |
| DELETE | `/transactions/:id`                 | `DeleteTransactionUseCase`        | 204  |

Mapeo de excepciones:

| Excepción de dominio                   | HTTP |
| -------------------------------------- | ---- |
| `TransactionNotFoundException`         | 404  |
| `AccountNotFoundException`             | 404  |
| `CategoryNotFoundException`            | 404  |
| `InsufficientFundsException`           | 422  |
| `CannotDeleteTransactionException`     | 409  |

---

## Paso 4 — Wiring

### 4.1 `TransactionsModule`

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([TransactionOrmEntity]),
    AccountsModule,    // provee GetAccountByIdUseCase + IAccountRepository
    CategoriesModule,  // provee GetCategoryByIdUseCase
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionMapper,
    CreateTransactionUseCase,
    GetTransactionByIdUseCase,
    GetTransactionsByAccountIdUseCase,
    GetTransactionsByUserIdUseCase,
    DeleteTransactionUseCase,
    {
      provide: ITransactionRepository,
      useClass: TransactionRepositoryImpl,
    },
  ],
})
export class TransactionsModule {}
```

### 4.2 Actualizar `AccountsModule`

Exportar `GetAccountByIdUseCase` y `IAccountRepository` para que `TransactionsModule` pueda inyectarlos.

### 4.3 Actualizar `CategoriesModule`

Exportar `GetCategoryByIdUseCase` para que `TransactionsModule` pueda validar la compatibilidad de naturaleza.

---

## Paso 4.5 — Consideraciones de infraestructura — Abstracción futura

### Por qué abstraemos la infraestructura

En la arquitectura de capas, la capa de **aplicación** (donde viven los use cases) debe ser agnóstica a la infraestructura. Actualmente hay dos dependencias que rompen esta regla:

1. **Dependencia del módulo `crypto`** — genera IDs
2. **Dependencia de TypeORM.DataSource** — gestiona transacciones de BD

Ambas son dependencias de infraestructura que quedan hardcodeadas en la lógica de negocio. En V1 esto es aceptable por practicidad, pero lo correcto según DDD y Clean Architecture es:

```
Dominio (entidades, VOs, puertos)
  ↓
Aplicación (use cases, DTOs) — NO DEBE CONOCER tecnologías específicas
  ↓
Infraestructura (ORM, HTTP, generadores, etc.) — aquí viven las dependencias
```

### TODO: Abstraer librerías de infra — Roadmap V2

En la implementación actual, los use cases de transacciones tienen dependencias explícitas de infraestructura que deberían abstraerse:

#### 1. **Generador de IDs: `crypto.randomUUID()`**

**Ubicación actual:**
- `CreateTransactionUseCase` usa `randomUUID()` directamente (import de `crypto`)
- Mismo patrón en `CreateAccountUseCase` y `CreateCategoryUseCase`

**Problema:**
- **Acoplamiento:** El use case depende de la librería específica `crypto` del runtime Node.js
- **Testing:** Es imposible mockear o controlar el generador de IDs en tests sin hacerlo de forma invasiva
- **Flexibilidad:** Si necesitas cambiar a NanoID (más corto, mejor para URLs) o a Snowflake (para sistemas distribuidos), requiere cambios en múltiples use cases
- **Auditoría de IDs:** No puedes saber cuántos IDs se han generado, detectar colisiones secuenciales, o implementar estrategias de prefijo por módulo

**Patrón actual (V1):**
```typescript
import { randomUUID } from 'crypto';  // ← acoplamiento directo

const transaction = Transaction.create({
  id: randomUUID(),  // ← llamada directa
  ...
});
```

**Solución (V2):** Patrón de puerto (interfaz) + adapters

**1. Definir el puerto en el dominio/aplicación (lo que el use case necesita):**
```typescript
// infrastructure/ports/id-generator.port.ts
export interface IIdGenerator {
  generate(): string;
}
```

**2. Implementaciones en infraestructura (estrategias intercambiables):**
```typescript
// infrastructure/adapters/uuid-v4.generator.ts
export class UUIDv4Generator implements IIdGenerator {
  generate(): string {
    return randomUUID();
  }
}

// infrastructure/adapters/nanoid.generator.ts
export class NanoIdGenerator implements IIdGenerator {
  generate(): string {
    return customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12)();
  }
}

// Para testing: mock que genera IDs predecibles
export class MockIdGenerator implements IIdGenerator {
  constructor(private sequence = 0) {}
  generate(): string {
    return `mock-id-${++this.sequence}`;
  }
}
```

**3. Inyectar en el use case:**
```typescript
export class CreateTransactionUseCase {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly getAccountByIdUseCase: GetAccountByIdUseCase,
    private readonly idGenerator: IIdGenerator,  // ← abstracción, no implementación
    // ... otros
  ) {}

  async execute(command: CreateTransactionCommand): Promise<Transaction> {
    const transaction = Transaction.create({
      id: this.idGenerator.generate(),  // ← agnóstico a la implementación
      // ...
    });
  }
}
```

**4. Wiring en el módulo:**
```typescript
@Module({
  providers: [
    CreateTransactionUseCase,
    {
      provide: IIdGenerator,
      useClass: UUIDv4Generator,  // ← elegir implementación aquí
      // useClass: NanoIdGenerator para cambiar globalmente
    },
  ],
})
export class TransactionsModule {}
```

**Beneficios:**
- ️✅ **Testabilidad:** El test inyecta `MockIdGenerator` y controla exactamente qué IDs se generan
- ✅ **Flexibilidad:** Cambiar a NanoID = una línea en el módulo, el use case no se entera
- ✅ **Reutilización:** `accounts`, `categories`, `budgets` usan el mismo generador
- ✅ **Evolución:** En V3 necesitas Snowflake IDs para sharding — cambias solo la implementación

#### 2. **Gestor de transacciones: `TypeORM.DataSource`**

**Ubicación actual:**
- `CreateTransactionUseCase` y `DeleteTransactionUseCase` inyectan `DataSource` directamente
- Llaman a `dataSource.createQueryRunner()`, `startTransaction()`, `commitTransaction()`, `rollbackTransaction()`, `release()`
- Patrón duplicado en ambos use cases (try/catch/finally idéntico)

**Problema:**
- **Acoplamiento fuerte:** El use case conoce la API específica de TypeORM (`QueryRunner`, métodos de transacción)
- **Migrabilidad:** Si necesitas cambiar a Prisma (que tiene API diferente) o Mikro-ORM, reprogramas ambos use cases
- **Duplicación:** El mismo patrón try/catch/finally aparece en múltiples lugares — si cambias la estrategia de transacciones, cambias en 5+ lugares
- **Testabilidad:** Mockear transacciones de BD requiere mockear la API completa de TypeORM, es complejo

**Patrón actual (V1):**
```typescript
import { DataSource } from 'typeorm';  // ← acoplamiento a TypeORM

const qr = this.dataSource.createQueryRunner();  // ← API TypeORM específica
await qr.connect();
await qr.startTransaction();
try {
  // operaciones
  await qr.commitTransaction();
} catch (err) {
  await qr.rollbackTransaction();
} finally {
  await qr.release();
}
```

**Solución (V2):** Patrón de puerto + adapters

**1. Definir el puerto (lo que el use case necesita — agnóstico de ORM):**
```typescript
// infrastructure/ports/transaction-manager.port.ts
export interface ITransaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): Promise<void>;
}

export interface ITransactionManager {
  begin(): Promise<ITransaction>;
}
```

**2. Implementación en infraestructura:**
```typescript
// infrastructure/adapters/typeorm-transaction-manager.ts
export class TypeOrmTransactionManager implements ITransactionManager {
  constructor(private dataSource: DataSource) {}

  async begin(): Promise<ITransaction> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    return {
      commit: async () => {
        await qr.commitTransaction();
        await qr.release();
      },
      rollback: async () => {
        await qr.rollbackTransaction();
        await qr.release();
      },
      release: async () => {
        // ya está incluido en commit/rollback, pero por simetría
        await qr.release();
      },
    };
  }
}

// Para Prisma (V3, si migramos)
export class PrismaTransactionManager implements ITransactionManager {
  constructor(private prisma: PrismaClient) {}

  async begin(): Promise<ITransaction> {
    // Las transacciones de Prisma funcionan diferente — aquí va la adaptación
    const transactionFn = this.prisma.$transaction;

    return {
      commit: async () => { /* ... */ },
      rollback: async () => { /* ... */ },
      release: async () => { /* ... */ },
    };
  }
}
```

**3. Usar en el use case:**
```typescript
export class CreateTransactionUseCase {
  constructor(
    private readonly transactionManager: ITransactionManager,  // ← abstracción
    // ...
  ) {}

  async execute(command: CreateTransactionCommand): Promise<Transaction> {
    // ... validaciones
    
    const tx = await this.transactionManager.begin();  // ← agnóstico de ORM
    try {
      await this.accountRepository.save(account, tx);
      const saved = await this.transactionRepository.save(transaction, tx);
      await tx.commit();
      return saved;
    } catch (err) {
      await tx.rollback();
      throw err;
    } finally {
      await tx.release();
    }
  }
}
```

**4. Wiring en el módulo:**
```typescript
@Module({
  providers: [
    CreateTransactionUseCase,
    DeleteTransactionUseCase,
    {
      provide: ITransactionManager,
      useClass: TypeOrmTransactionManager,  // ← implementación actual
      // cambiar a PrismaTransactionManager en V3
    },
  ],
})
export class TransactionsModule {}
```

**5. Cambio de ORM (V3, ejemplo):**
Si necesitas migrar de TypeORM a Prisma:
- Solo cambias la línea del módulo: `useClass: PrismaTransactionManager`
- Los use cases no se tocan
- El patrón de transacciones es consistente en toda la app

**Beneficios de la abstracción:**
- ✅ **Independencia del ORM:** Cambiar a Prisma/Mikro-ORM = cambiar una clase, los use cases no se enteran
- ✅ **DRY (Don't Repeat Yourself):** El patrón try/catch/finally se escribe una sola vez
- ✅ **Testabilidad:** Puedes inyectar un `MockTransactionManager` que no toca BD
- ✅ **Evolución:** Si necesitas enriquecer transacciones (savepoints, timeouts), lo haces en un lugar
- ✅ **Multipersistencia:** Si en el futuro necesitas soportar múltiples BDs, puedes tener múltiples implementaciones

### Por qué estas abstracciones están en V2, no en V1

La decisión de mantener `randomUUID` e `ITransactionRepository.save()` sin abstraer en V1 responde a:

1. **Acoplamiento aceptable en V1:** Para un prototipo/MVP, es pragmático usar TypeORM directamente. La abstracción agrega complejidad sin dolor real aún (solo tienes 1 ORM).

2. **Validación de hipótesis:** Necesitas entender si el patrón de transacciones atómicas con QueryRunner es realmente la solución antes de abstraerlo. Si en V2 encuentras que Prisma es mejor, habrás validado con V1 cuál es la inversión real.

3. **Cambio concentrado:** Es más fácil abstraer después de que el código está escrito y probado. Abstraer con código especulativo es hacer work twice.

4. **Costo de abstracción:** Crear `IIdGenerator`, `ITransactionManager`, wiring en módulos = 300+ líneas de código nuevo. En V1 no vale la pena para 2 use cases.

5. **Lecciones aprendidas:** Implementar V1 te muestra exactamente qué parte de TypeORM necesitas abstraer. En V2 la abstracción será más precisa porque sabes qué duele.

---

## Paso 5 — Verificación

- [ ] `POST /transactions` con income crea la transacción y aumenta el balance de la cuenta
- [ ] `POST /transactions` con expense crea la transacción y disminuye el balance de la cuenta
- [ ] `POST /transactions` con monto negativo retorna `400 Bad Request`
- [ ] `POST /transactions` con cuenta inexistente retorna `404 Not Found`
- [ ] `POST /transactions` con categoría inexistente retorna `404 Not Found`
- [ ] `POST /transactions` con categoría de tipo incompatible retorna `400 Bad Request`
- [ ] `POST /transactions` expense con fondos insuficientes retorna `422 Unprocessable Entity`
- [ ] `GET /transactions/:id` retorna la transacción
- [ ] `GET /transactions/account/:accountId` retorna el array de transacciones de la cuenta
- [ ] `GET /transactions/user/:userId` retorna todas las transacciones del usuario
- [ ] `DELETE /transactions/:id` elimina y revierte el balance
- [ ] `DELETE /transactions/:id` de un income que dejaría balance negativo retorna `409 Conflict`
