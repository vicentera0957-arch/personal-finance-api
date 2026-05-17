# ⚠️ ARCHIVO OBSOLETO

Este documento es un análisis pre-implementación de los módulos `categories` y `transactions`.
El módulo ya está implementado y documentado. Ver en su lugar:

- `src/modules/categories/notes.md` — referencia actual del módulo categories
- `src/modules/transactions/notes.md` — referencia actual del módulo transactions
- `CLAUDE.md` — arquitectura global y bugs activos

---

# [CONTENIDO HISTÓRICO — no refleja el estado actual del código]

# Análisis Completo: Categories y Transactions

## PARTE 1 — CATEGORIES MODULE (Explicación detallada)

### Lo que el módulo hace y por qué

Categories es un módulo de clasificación. Su único propósito es darle al usuario un vocabulario propio para categorizar sus movimientos económicos: "Supermercado", "Sueldo", "Netflix", etc. Cada categoría pertenece a un usuario (`userId`) y tiene una naturaleza (`nature`) que indica si aplica para ingresos o gastos.

La decisión de diseño más importante de este módulo es que **`nature` es inmutable una vez creada**. Esto no es capricho: si una categoría tiene transactions asociadas, cambiar su nature rompería la consistencia de esos registros. Una transacción de tipo `income` apuntando a una categoría `expense` sería un error semántico en los datos históricos.

---

### Domain Layer — Pieza a pieza

#### **`CategoryNature` Value Object** (`category-nature.vo.ts`)

Este VO existe para garantizar que el campo `nature` solo pueda tener dos valores posibles: `'income'` o `'expense'`. Sin este VO, `nature` sería un simple `string` y cualquier parte del código podría asignarle `'ingresso'`, `'gasto'`, `'INCOME'`, o cualquier valor inválido sin que el compilador lo detecte.

La implementación tiene un patrón clásico de VO:

- Constructor privado — nadie puede crear uno directamente
- `create(value)` — factory con validación, normaliza a minúsculas y trim
- Los helpers `isIncome()` e `isExpense()` son más legibles que comparar strings directamente

**Detalle importante a tener en cuenta**: `CategoryNature.create()` lanza un `Error` genérico, no una excepción de dominio tipada (`CategoryException`). Esto es inconsistente con el patrón del resto del proyecto donde las excepciones son tipadas y mapeables en el controller. Si el controller recibe este error genérico, va al `throw e` del catch y NestJS lo convierte en un 500 Internal Server Error en vez de un 400 Bad Request.

#### **`Category` Entity** (`category.entity.ts`)

La entidad tiene todos sus campos privados excepto `id`, `userId`, `nature` y `createdAt` que son `readonly` públicos. Esto significa que el único camino para leer `name`, `color`, `icon` o `isBudgetable` es a través de getters, y el único camino para modificarlos es a través de métodos de negocio. Este patrón garantiza que la entidad controla sus propias invariantes.

Los cuatro métodos de mutación son:

- `rename(name)` — valida que no esté vacío, actualiza `updatedAt`
- `changeColor(color)` — **no valida nada**, acepta cualquier string
- `changeIcon(icon)` — **no valida nada**, acepta cualquier string
- `setBudgetable(value)` — acepta boolean, no puede fallar

El problema: `rename()` lanza `new Error('...')` en vez de `new InvalidCategoryNameException()`. Esto rompe el patrón del proyecto donde las excepciones de dominio son tipadas para que el controller pueda atraparlas con `instanceof` y asignarles el código HTTP correcto.

#### **`ICategoryRepository`** (`category.repository.ts`)

Interfaz como clase abstracta (para ser token de DI en NestJS). El método más específico es `findByUserIdAndNameAndNature()` que existe exclusivamente para validar duplicados antes de crear una categoría. Esta es una buena práctica: la lógica de duplicados no está en la base de datos como constraint UNIQUE, sino en el dominio donde podemos dar un mensaje de error descriptivo.

#### **Excepciones** (`category.exceptions.ts`)

Solo hay dos:

- `CategoryNotFoundException` — cuando no se encuentra por id
- `DuplicateCategoryException` — cuando ya existe nombre+nature para ese usuario

Hay un gap: no existe `InvalidCategoryNameException`. Cuando `rename()` falla (nombre vacío), lanza un `Error` genérico que no está siendo capturado en el controller.

---

### Application Layer — Use Cases

#### **`CreateCategoryUseCase`**

Flujo:

1. Crea el VO `CategoryNature` (valida que sea income/expense)
2. Consulta `findByUserIdAndNameAndNature()` para duplicados
3. Si existe, lanza `DuplicateCategoryException`
4. Crea la entidad con `Category.create()`
5. Persiste y retorna

Un detalle: la validación de duplicados usa `command.name.trim()` para buscar, pero `Category.create()` recibe `command.name` sin trim. El `rename()` de la entidad sí hace trim internamente, pero `create()` no. Hay una inconsistencia menor: si el usuario manda `"  Supermercado  "`, el check de duplicados busca `"Supermercado"` pero la entidad se guarda con `"  Supermercado  "`.

#### **`UpdateCategoryUseCase`**

Patrón muy limpio: delega el fetch al `GetCategoryByIdUseCase` (reutilización, no duplicación), luego solo llama al método de entidad correspondiente si el campo viene en el comando. Esto permite actualizaciones parciales correctas: si solo mandas `{ color: "#FF0000" }`, solo se actualiza el color.

#### **`DeleteCategoryUseCase`**

Este es el gap más crítico del módulo. Verifica que la categoría existe y la elimina. Pero **no verifica si existen transacciones asociadas a esa categoría**. Si hay transactions con ese `categoryId` y eliminas la categoría, esas transactions quedan apuntando a un `categoryId` que ya no existe. La DB no tiene FK constraint definido entre `transactions.category_id` → `categories.id`, por lo que TypeORM dejará pasar el delete sin error.

---

### Infrastructure Layer

#### **`CategoryMapper`** (`category.mapper.ts`)

El mapper tiene un detalle interesante en `toDomain()`: usa `CategoryNature.create(orm.nature)` (con validación) en vez de un `reconstitute()`. Esto difiere del patrón usado en otros módulos (accounts, users, transactions) donde el mapper siempre usa `reconstitute()` para evitar re-validar datos que ya están en la DB. La implicación práctica: si en el futuro cambias las reglas de validación de `CategoryNature`, el mapper podría fallar al leer datos históricos válidos en ese momento de creación.

#### **`CategoryRepositoryImpl`** (`category.repo.implement.ts`)

Implementación directa con TypeORM, sin sorpresas. `save()` usa el método `save()` de TypeORM que hace INSERT o UPDATE automáticamente según si el id existe. El método `delete()` no verifica existencia (eso lo hace el use case antes de llamarlo).

#### **`CategoriesModule`** (`categories.module.ts`)

El módulo exporta `GetCategoryByIdUseCase` porque el módulo de transactions lo necesita para validar que la categoría existe y que su nature es compatible con la transacción (regla R7).

---

## PARTE 2 — TRANSACTIONS MODULE (Explicación detallada)

### Lo que el módulo hace y por qué

Transactions es el corazón operativo de la app. Cada transacción representa un movimiento económico real: un ingreso que entró a una cuenta, o un gasto que salió de ella. Este módulo es el único que **modifica balances de cuentas** (afecta al módulo accounts) y el único que necesita que la **categoría sea compatible** con la naturaleza de la transacción (afecta al módulo categories).

La decisión de diseño fundamental es que **las transacciones son inmutables como registros contables**. No hay `UpdateTransactionUseCase`. Esta decisión viene de contabilidad: si cometiste un error en un asiento contable, no se edita — se hace un asiento de corrección. Aquí simplificamos eso como: eliminas la transacción incorrecta (que revierte el balance) y creas una nueva.

---

### Domain Layer — Pieza a pieza

#### **`TransactionNature` Value Object** (`transaction-nature.vo.ts`)

Idéntico en comportamiento a `CategoryNature`. La pregunta obvia es: ¿por qué duplicar el VO en vez de compartirlo? La razón es **independencia de bounded contexts**. Si en el futuro `transactions` necesita un tipo `'transfer'` (para transferencias entre cuentas), puede agregarlo sin afectar a `categories`. Si se compartiera el VO, una categoría podría ser de tipo `'transfer'` lo cual no tiene sentido semántico.

Mismo problema que `CategoryNature`: lanza `Error` genérico en vez de una excepción de dominio tipada.

#### **`Amount` Value Object** (`amount.vo.ts`)

Captura el monto de una transacción. La diferencia crítica con `Balance` del módulo accounts:

- `Amount` debe ser **estrictamente mayor a cero** (no puedes crear una transacción de $0)
- `Balance` puede ser **cero** (una cuenta puede tener saldo cero)

Esta distinción semántica justifica que sean VOs separados en vez de compartir el mismo.

Mismo problema de excepciones: lanza `Error` genérico.

#### **`Transaction` Entity** (`transaction.entity.ts`)

La entidad más simple del proyecto. **Todos los campos son `readonly`**. No hay ningún método de mutación. El diseño refleja perfectamente la inmutabilidad contable.

Campos relevantes:

- `transactionDate: Date` — la fecha real del movimiento. Un usuario puede registrar hoy una transacción que ocurrió hace dos semanas. Esta separación de `transactionDate` vs `createdAt` es importante para reportes financieros correctos.
- Sin `updatedAt` — ningún campo cambia post-creación, por lo que no tiene sentido tener esta columna.

#### **Excepciones** (`transaction.exceptions.ts`)

Tres excepciones bien tipadas:

- `TransactionNotFoundException` — 404 estándar
- `CannotDeleteTransactionException` — 409, cuando eliminar un ingreso dejaría el balance negativo
- `IncompatibleCategoryNatureException` — 400, la regla R7 del negocio

---

### Application Layer — Use Cases

#### **`CreateTransactionUseCase`** — El use case más complejo del proyecto

Este use case orquesta tres módulos: transactions, accounts y categories. El flujo en orden:

```
1. Valida nature VO (TransactionNature.create)
2. Valida amount VO (Amount.create)
3. Verifica que la cuenta existe (GetAccountByIdUseCase)
4. Verifica que la categoría existe (GetCategoryByIdUseCase)
5. Valida que category.nature === transaction.nature (R7)
6. Crea la entidad Transaction
7. Aplica inflow/outflow en la cuenta
8. Guarda la cuenta (accountRepository.save)
9. Guarda la transacción (transactionRepository.save)
```

**El problema crítico de atomicidad**: Los pasos 8 y 9 son dos operaciones de base de datos separadas sin transacción de BD que las envuelva. Si el paso 8 tiene éxito (el balance de la cuenta se actualiza en la DB) pero el paso 9 falla (la transaction no se guarda), el sistema queda en un estado inconsistente: el balance de la cuenta refleja un movimiento que no tiene registro de transaction asociado. Este dinero "desapareció" sin rastro.

La solución es usar `QueryRunner` de TypeORM para ejecutar ambas operaciones dentro de una transacción de base de datos atómica.

#### **`DeleteTransactionUseCase`** — El espejo de create

```
1. Obtiene la transacción
2. Obtiene la cuenta
3. Revierte el efecto: income → outflow, expense → inflow
4. Si el outflow de reversion falla (balance insuficiente) → CannotDeleteTransactionException
5. Guarda la cuenta con balance revertido
6. Elimina la transacción
```

El mismo problema de atomicidad existe aquí entre los pasos 5 y 6.

Hay también una asimetría semántica a notar: el catch genérico en el paso 3-4 captura **cualquier** excepción del `account.outflow()` y la convierte en `CannotDeleteTransactionException`. Esto es correcto para `InsufficientFundsException`, pero si en el futuro `outflow()` lanza otras excepciones (como `CannotOperateOnArchivedAccountException`), esas también quedarían enmascaradas como si el problema fuera el balance. El catch debería ser más específico.

---

### Infrastructure Layer

#### **`TransactionOrmEntity`** (`transaction.orm.entity.ts`)

Sin `updatedAt` — consistente con la inmutabilidad del dominio. `transactionDate` usa `type: 'timestamp'` explícitamente para separar la fecha del movimiento de `createdAt`. No hay foreign keys definidas en TypeORM — las relaciones son lógicas, no de constraint de BD.

#### **`TransactionsModule`** (`transactions.module.ts`)

Importa `AccountsModule` y `CategoriesModule`. Esto es lo que permite inyectar `GetAccountByIdUseCase`, `IAccountRepository` y `GetCategoryByIdUseCase` en los use cases de transactions. No exporta nada — ningún otro módulo necesita consumir transactions aún.

#### **`TransactionsController`** (`transactions.controller.ts`)

El controller tiene que atrapar excepciones de tres dominios distintos: transactions, accounts y categories. Por eso importa excepciones de los tres módulos. Hay un mapeo muy específico: `InsufficientFundsException` → **422 Unprocessable Entity** (no un 400), lo cual es semánticamente correcto: el request está bien formado, pero el estado del recurso no permite ejecutarlo.

---

## PARTE 3 — PLAN DE MEJORAS

Este plan está ordenado por impacto y dependencias. Cada item incluye qué hay que cambiar, dónde y por qué.

---

### BLOQUE 1 — Correcciones de consistencia (Bajo riesgo, alto valor)

#### **1.1 — Crear excepciones de dominio faltantes en Categories** LISTO

**Qué**: Crear `InvalidCategoryNameException` en `category.exceptions.ts`. Modificar `Category.rename()` para que la lance en vez de `new Error()`.

**Por qué**: El controller de categories tiene un catch para `CategoryNotFoundException` y `DuplicateCategoryException`, pero no para errores de validación internos de la entidad. Cuando `rename('')` falla, el error genérico llega al último `throw e` y NestJS devuelve un 500. Con una excepción tipada, el controller puede atraparla y devolver un 400.

**Dónde**:

- `category.exceptions.ts` — agregar `InvalidCategoryNameException`
- `category.entity.ts` — usar la nueva excepción en `rename()`
- `categories.controller.ts` — agregar el catch en el endpoint `PATCH /:id`

#### **1.2 — Corregir CategoryMapper para usar `CategoryNature` sin re-validación**

**Qué**: En `category.mapper.ts`, cambiar `CategoryNature.create(orm.nature)` por un `CategoryNature.reconstitute(orm.nature)` (que habría que agregar al VO).

**Por qué**: El mapper lee datos de la base de datos. Esos datos ya fueron validados cuando se guardaron. Re-validarlos al leerlos significa que si en el futuro cambias las reglas de validación (ej: agregas `'ahorro'` como nature válido), los registros históricos que tengan `'income'` seguirían siendo válidos, pero si cambias que solo `'gasto'` es válido, la lectura de datos históricos fallaría. El `reconstitute()` evita esto.

**Dónde**:

- `category-nature.vo.ts` — agregar método `static reconstitute(value: string): CategoryNature`
- `category.mapper.ts` — cambiar línea 12 a usar `reconstitute()`

#### **1.3 — Consistencia en el trim del nombre al crear categoría**

**Qué**: En `CreateCategoryUseCase`, la búsqueda de duplicados hace `command.name.trim()` pero `Category.create()` recibe `command.name` sin trim.

**Dónde**: `create-category.use-case.ts` — hacer trim antes de pasar al `Category.create()`.

---

### BLOQUE 2 — Protección de integridad referencial (Impacto medio)

#### **2.1 — Proteger DeleteCategory cuando hay transacciones asociadas**

Este es el problema más importante de categories porque afecta consistencia de datos.

**El dilema**: Para saber si una categoría tiene transacciones, necesitas acceder al repositorio de transactions. Pero `CategoriesModule` no puede importar `TransactionsModule` porque eso crearía una dependencia circular (`CategoriesModule` → `TransactionsModule` → `CategoriesModule`).

**Opciones**:

**Opción A (No recomendada)**: Agregar a `ITransactionRepository` un método `existsByCategoryId(categoryId: string): Promise<boolean>`. Luego exportar `ITransactionRepository` desde `TransactionsModule` y usarlo en `DeleteCategoryUseCase`. Esto requiere que `CategoriesModule` importe `TransactionsModule`, y `TransactionsModule` importe `CategoriesModule` — **dependencia circular**. No funciona.

**Opción B (Recomendada)**: El delete de categoría devuelve un error descriptivo cuando la DB lanza un FK constraint violation. Para esto habría que agregar la FK constraint en la DB entre `transactions.category_id` → `categories.id`. El `CategoryRepositoryImpl.delete()` capturaría el error de TypeORM y lo convertiría en una excepción de dominio `CategoryInUseException`.

**Opción C (Más simple para V1)**: En el controller de categories, antes de llamar a `DeleteCategoryUseCase`, llamar a `GetTransactionsByCategoryId` — pero este use case no existe aún. Alternativa: usar la regla de negocio que "si una categoría tiene transacciones, no se puede eliminar — habría que eliminar primero las transacciones o reasignarlas". Esta decisión de negocio debe ser explícita.

**Recomendación**: Implementar Opción B con FK constraint en la DB y captura de error en el repositorio. Es la forma más robusta y no requiere cambiar la arquitectura de módulos.

**Cambios**:

- Agregar FK constraint en schema de `transactions` tabla
- Crear excepción `CategoryInUseException extends CategoryException`
- En `CategoryRepositoryImpl.delete()`, capturar error de FK violation y lanzar `CategoryInUseException`
- En `categories.controller.ts`, agregar catch para `CategoryInUseException` → 409 ConflictException

---

### BLOQUE 3 — Atomicidad en Transactions (CRÍTICO)

#### **3.1 — Envolver CreateTransaction en una transacción de BD**

**Qué**: Usar `DataSource` de TypeORM para crear un `QueryRunner` y ejecutar el save de la cuenta y el save de la transacción dentro de `BEGIN / COMMIT`, con `ROLLBACK` si alguno falla.

**Por qué**: Sin esto, existe la posibilidad real de que el balance de una cuenta cambie sin que exista el registro de la transacción que lo explica. Los datos financieros pierden trazabilidad.

**Dónde**: `CreateTransactionUseCase` y `DeleteTransactionUseCase`. El `QueryRunner` se obtiene del `DataSource` inyectado.

**Cómo queda el flujo**:

```typescript
const queryRunner = this.dataSource.createQueryRunner();
await queryRunner.connect();
await queryRunner.startTransaction();
try {
  // account.save() y transaction.save() dentro de la transacción
  await this.accountRepository.save(account, queryRunner);
  await this.transactionRepository.save(transaction, queryRunner);
  await queryRunner.commitTransaction();
} catch (err) {
  await queryRunner.rollbackTransaction();
  throw err;
} finally {
  await queryRunner.release();
}
```

El desafío arquitectónico es que los repositorios actuales (`IAccountRepository`, `ITransactionRepository`) no aceptan un `QueryRunner`. Hay que decidir: ¿pasar el `QueryRunner` como parámetro a los métodos de repositorio, o inyectar el `DataSource` directamente en el use case y manejar la transacción ahí?

Para mantener el diseño limpio, la opción recomendada es **pasar el `QueryRunner` como parámetro opcional** a los métodos `save()` de los repositorios que participan en operaciones atómicas.

**Cambios**:

- Firmas de `IAccountRepository.save()` e `ITransactionRepository.save()` aceptan `queryRunner?: QueryRunner`
- Implementaciones en `AccountRepositoryImpl` y `TransactionRepositoryImpl` usan `queryRunner.manager.save()` si se proporciona
- `CreateTransactionUseCase` y `DeleteTransactionUseCase` crean `QueryRunner`, envuelven las operaciones, manejan commit/rollback

---

### BLOQUE 4 — Paginación y Filtros (Funcionalidad nueva)

#### **4.1 — Agregar paginación a GetTransactionsByUserId y GetTransactionsByAccountId**

**Qué**: Los endpoints actuales devuelven todos los registros. Un usuario con 2 años de historial podría tener miles de transacciones.

**Interface propuesta**:

```
GET /transactions/user/:userId?page=1&limit=20&from=2025-01-01&to=2025-03-31
```

**Dónde**:

- `ITransactionRepository` — cambiar firma de `findByUserId()` para aceptar opciones de paginación y filtro
- `TransactionRepositoryImpl` — implementar con TypeORM `skip/take` y `where` con rango de fechas
- DTO de query params nuevo
- Use case recibe los parámetros de paginación

**Cambios**:

```typescript
// En ITransactionRepository
async findByUserId(
  userId: string,
  options?: { limit?: number; offset?: number; from?: Date; to?: Date }
): Promise<Transaction[]>;

// En TransactionRepositoryImpl
async findByUserId(userId: string, options?: {...}): Promise<Transaction[]> {
  let query = this.ormRepository.find({
    where: { userId }
  });

  if (options?.from || options?.to) {
    query.where.transactionDate = Between(options.from, options.to);
  }

  if (options?.limit) query.take(options.limit);
  if (options?.offset) query.skip(options.offset);

  return query.map(orm => this.mapper.toDomain(orm));
}
```

---

### BLOQUE 5 — Corrección del catch genérico en DeleteTransaction

#### **5.1 — Ser específico en el catch de reversion de balance**

**Dónde**: `delete-transaction.use-case.ts` línea 40

**Cambio**: En vez de atrapar cualquier error del `outflow()`, atrapar específicamente `InsufficientFundsException`. Si la cuenta está archivada y lanza `CannotOperateOnArchivedAccountException`, ese error debería llegar al controller como tal (409 Conflict), no convertirse en `CannotDeleteTransactionException`.

```typescript
// ANTES
try {
  if (transaction.nature.isIncome()) {
    account.outflow(balanceAmount);
  } else {
    account.inflow(balanceAmount);
  }
} catch {
  throw new CannotDeleteTransactionException(id);
}

// DESPUÉS
try {
  if (transaction.nature.isIncome()) {
    account.outflow(balanceAmount);
  } else {
    account.inflow(balanceAmount);
  }
} catch (err) {
  if (err instanceof InsufficientFundsException) {
    throw new CannotDeleteTransactionException(id);
  }
  throw err; // propagar otros errores
}
```

---

## PARTE 4 — PRINCIPIOS Y CONOCIMIENTOS PARA IMPLEMENTAR ESTO

### Principios de DDD que aplican aquí

#### **Value Objects son inmutables y auto-validantes**

Cuando creas un VO con `create()`, ya sabes que es válido. Nunca guardas un VO inválido en una entidad. Por eso los métodos de entidad que reciben strings primitivos (como `rename(name: string)`) deben validar ellos mismos o confiar en que el use case ya pasó por un VO.

#### **Las excepciones de dominio NO son HTTP exceptions**

Una excepción de dominio como `InvalidCategoryNameException` sabe que el nombre es inválido pero no sabe (ni le importa) si eso se traduce en HTTP 400, 422 o cualquier otro código. Esa traducción ocurre **solo** en el controller. Si una excepción lanza `Error` genérico, el controller no puede atraparla con `instanceof` y devuelve un 500 por defecto.

#### **El mapper es el guardián de la frontera dominio/persistencia**

El mapper usa `reconstitute()` al leer de la DB porque los datos ya fueron validados. Usar `create()` en el mapper es un error conceptual: estarías validando datos que ya vivieron en el sistema, posiblemente con reglas distintas a las actuales.

#### **Los use cases son orquestadores, no implementadores**

El use case sabe el orden de los pasos del flujo de negocio, pero delega la lógica real a entidades, VOs y repositorios. `CreateTransactionUseCase` no calcula el nuevo balance — llama a `account.inflow()` que lo hace. El use case solo sabe que "si es un ingreso, llamo inflow; si es gasto, llamo outflow".

---

### Conocimiento técnico necesario

#### **TypeORM QueryRunner para transacciones atómicas**

Un `QueryRunner` es un "canal" de ejecución de SQL que puede agrupar múltiples operaciones bajo `BEGIN / COMMIT / ROLLBACK`. Se obtiene del `DataSource`:

```typescript
const queryRunner = this.dataSource.createQueryRunner();
await queryRunner.connect();
await queryRunner.startTransaction();
try {
  // operaciones...
  await queryRunner.commitTransaction();
} catch (err) {
  await queryRunner.rollbackTransaction();
  throw err;
} finally {
  await queryRunner.release();
}
```

El desafío es que los repositorios actuales reciben un `Repository<T>` inyectado por NestJS, y ese `Repository` no comparte la transacción del `QueryRunner`. Tienes que usar `queryRunner.manager.save(entity)` o pasar el `queryRunner` a los métodos del repositorio.

#### **NestJS Module exports e imports para dependencias cruzadas**

Cuando `TransactionsModule` necesita usar `GetCategoryByIdUseCase` de `CategoriesModule`:

1. `CategoriesModule` debe tener `GetCategoryByIdUseCase` en su array `exports`
2. `TransactionsModule` debe importar `CategoriesModule` en su array `imports`
3. NestJS hace disponible el use case en el contexto de DI de `TransactionsModule`

Si intentas crear una dependencia circular (A importa B, B importa A), NestJS falla con un error en tiempo de arranque. La solución a las dependencias circulares es usar `forwardRef()` o rediseñar la arquitectura para que la dependencia sea unidireccional.

#### **TypeORM `save()` vs `insert()` vs `update()`**

- `save(entity)`: INSERT si el id no existe en la DB, UPDATE si existe. Carga el entity antes de guardar (hace un SELECT primero). Es más lento pero más seguro.
- `insert(entity)`: INSERT puro, falla si el id ya existe. Sin SELECT previo.
- `update(id, partial)`: UPDATE puro sobre los campos que le pasas. Sin SELECT previo.

En este proyecto se usa `save()` en todos lados, lo cual está bien para V1. En producción, `insert()` para creaciones y `update()` para actualizaciones serían más eficientes.

#### **Patrón `instanceof` para exception handling en NestJS**

El controller captura excepciones de dominio con `instanceof`:

```typescript
catch (e) {
  if (e instanceof CategoryNotFoundException) throw new NotFoundException(e.message);
  if (e instanceof DuplicateCategoryException) throw new ConflictException(e.message);
  throw e; // re-lanza lo que no reconoces
}
```

El `throw e` al final es fundamental. Sin él, cualquier excepción no reconocida sería silenciada y el cliente recibiría un `undefined` o un error serializado incorrectamente.

#### **Por qué las interfaces de repositorio son `abstract class` y no `interface` TypeScript**

TypeScript `interface` desaparece en runtime — el JavaScript compilado no tiene rastro de ella. NestJS usa los tokens de DI en runtime para resolver dependencias. Si `IUserRepository` fuera una `interface`, no existiría como valor JavaScript y NestJS no podría usarla como token. Al declararla como `abstract class`, TypeScript la compila a una clase JavaScript real con un nombre, y NestJS puede usarla como token de DI.

---

## Resumen del plan en tabla de prioridad

| #   | Qué                                                                      | Dónde                                                      | Prioridad | Riesgo |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------------------- | --------- | ------ |
| 1.1 | Crear `InvalidCategoryNameException` y usarla en `rename()`              | `category.exceptions.ts`, `category.entity.ts`, controller | Alta      | Bajo   |
| 1.2 | Agregar `CategoryNature.reconstitute()` y usarlo en mapper               | `category-nature.vo.ts`, `category.mapper.ts`              | Media     | Bajo   |
| 1.3 | Trim consistente al crear categoría                                      | `create-category.use-case.ts`                              | Baja      | Mínimo |
| 2.1 | FK constraint + captura de error al eliminar categoría con transacciones | DB schema, `category.repo.implement.ts`, exceptions        | Alta      | Medio  |
| 3.1 | Atomicidad en CreateTransaction y DeleteTransaction con QueryRunner      | Use cases, repositorios, module                            | CRÍTICA   | Alto   |
| 4.1 | Paginación y filtros de fecha en listados                                | `ITransactionRepository`, impl, use cases, controller      | Media     | Medio  |
| 5.1 | Catch específico en DeleteTransaction                                    | `delete-transaction.use-case.ts`                           | Media     | Bajo   |

---

## Orden recomendado de implementación

1. **Primero BLOQUE 3.1** — Atomicidad es crítica para integridad de datos
2. **Luego BLOQUE 1** — Correcciones de consistencia en excepciones
3. **Luego BLOQUE 2.1** — Protección de integridad referencial
4. **Luego BLOQUE 5.1** — Mejora del manejo de excepciones
5. **Finalmente BLOQUE 4.1** — Feature nueva de paginación/filtros
