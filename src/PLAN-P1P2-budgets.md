# PLAN — P1 + P2 (par `budgets` ↔ `transactions`) + P6

> Referencia obligatoria: `src/PROBLEMS.md` (P1 líneas 94-131, P2 135-168, P6 272-290).
> Este documento **no repite** PROBLEMS.md: aporta verificación, la decisión de diseño resuelta,
> la demostración del lock model y el orden de ejecución.
> Alcance: **sólo budgets**. `accounts` lo planifica otro agente; ninguna línea de este plan toca
> `accounts/`, salvo la nota explícita en §4.4 sobre `transactions.module.ts:32` (que **no** se toca).

---

## 1. Estado verificado del acoplamiento

### 1.1 La arista `budgets → transactions` existe por un solo motivo

| Hecho | Evidencia |
| --- | --- |
| `budgets` importa `TransactionsModule` | `src/modules/budgets/budgets.module.ts:17` (import) y `:23` (`forwardRef(() => TransactionsModule)` en `imports`) |
| Es el **único** símbolo de transactions que budgets referencia en todo el módulo | `grep "from '.*transactions" src/modules/budgets/` → **1 sola coincidencia**: `budgets.module.ts:17` |
| El provider que justifica ese import vive en transactions | `src/modules/transactions/transactions.module.ts:67-70` (`{ provide: IBudgetUnitOfWork, useExisting: TypeOrmUnitOfWorkImpl }`) y `:76` (export) |
| `transactions` **no inyecta** `IBudgetUnitOfWork` en ningún lado | `grep IBudgetUnitOfWork src/**/*.ts`: sólo aparece en `budgets/domain/IBudgetUnitOfWork.ts`, los 2 use cases de budgets + sus specs, `transactions.module.ts:15,57,68,76`, `unit-of-work.impl.ts:4,251,257` y el fake `in-memory-unit-of-work.ts:2,10`. Ningún constructor de transactions lo recibe. |

Conclusión: la arista es **puramente de DI**. No hay dependencia de dominio, application ni persistencia.

### 1.2 `ScopedExpenseChecker` ya no depende de transactions — **confirmado**

`src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts:188-243`.

- Constructor: `constructor(private readonly manager: EntityManager)` (`:189`) — un solo parámetro, sin mapper.
- `hasExpensesInPeriod` (`:193-218`): `COUNT(*)` con `.from('v_period_expenses', 'e')` (`:203`).
- `sumExpenseAmountInPeriod` (`:220-242`): `COALESCE(SUM(e.amount), 0)` con `.from('v_period_expenses', 'e')` (`:231`).
- Símbolos externos usados: `IExpenseChecker` (`budgets/domain`, import en `:9`) y `monthPeriod` (`shared/domain`, import en `:19`).
- **No** referencia `TransactionOrmEntity` ni `TransactionMapper` ni `Transaction`.

Es decir: la clase es *ya* código de budgets alojado en el archivo equivocado. Mover el archivo no cambia una línea de su cuerpo.

**Precedente confirmado:** `src/modules/reports/reports.module.ts:18-25` no importa ningún módulo, y `src/modules/reports/infrastructure/persistence/reports-read-store.impl.ts:51-55` lee `v_period_expenses` con SQL crudo inyectando `DataSource`. Cero acoplamiento de compilación a transactions, mismo dato. El comentario del módulo (`reports.module.ts:11-14`) formula exactamente la tesis de este refactor: *"la dependencia sobre transactions es sólo a nivel de SCHEMA, no de compilación"*.

**Deriva documental detectada:** el comentario de cabecera del puerto (`src/modules/budgets/domain/repository/expense-checker.port.ts:1-3`) afirma *"La implementación concreta vive en transactions y se inyecta en budgets"*. Queda falso tras el refactor; hay que reescribirlo (§4.1).

### 1.3 Los dos use cases de budgets usan sólo el UoW — **confirmado**

`delete-budget.use-case.ts`: inyecta `IBudgetUnitOfWork` (`:13`) e `IBudgetsCache` (`:14`). Dentro del `begin/try`: `getScopedBudgetRepository()` (`:21`), `budgetRepo.findById` (`:26`), `getScopedExpenseChecker().hasExpensesInPeriod` (`:33-40`), `budgetRepo.delete` (`:50`), `commit` (`:51`).

`update-budget-limit.use-case.ts`: inyecta `IBudgetUnitOfWork` (`:21`) e `IBudgetsCache` (`:22`). `getScopedBudgetRepository()` (`:29`), `findById` (`:34`), `getScopedExpenseChecker().sumExpenseAmountInPeriod` (`:42-49`), `budgetRepo.save` (`:62`), `commit` (`:63`).

Ninguno toca repos de transactions ni de accounts. **La frontera transaccional de budgets es autosuficiente.**

### 1.4 Ningún use case del sistema inyecta dos tokens de UoW

Verificado con `grep "I(Account|Transaction|Budget|Auth)UnitOfWork" src/modules/**/application/use-cases/*.ts`:

| Use case | Token único |
| --- | --- |
| `create-transaction.use-case.ts:30`, `delete-transaction.use-case.ts:14` | `ITransactionUnitOfWork` |
| `delete-budget.use-case.ts:13`, `update-budget-limit.use-case.ts:21` | `IBudgetUnitOfWork` |
| `archive-account.use-case.ts:14`, `unarchive-account.use-case.ts:14`, `rename-account.use-case.ts:15` | `IAccountUnitOfWork` |
| `refresh-token.use-case.ts:20` | `IAuthUnitOfWork` |

**Este hecho es el pilar de §3.** El `useExisting` de `transactions.module.ts:63-74` sólo tendría efecto observable si algún consumidor pidiera dos tokens en el mismo request. Ninguno lo hace. Por tanto el aliasing es, hoy, DI ceremonial: no compra ninguna garantía de concurrencia que se pierda al partirlo.

### 1.5 El molde existente: `AuthUnitOfWorkImpl`

`src/modules/auth/infrastructure/persistence/auth-unit-of-work.impl.ts`:
- `ScopedRefreshTokenRepository` privado al archivo (`:11-56`), no exportado.
- `@Injectable({ scope: Scope.REQUEST })` + `extends IAuthUnitOfWork` (`:60-61`).
- Campo `private queryRunner: QueryRunner | null = null` (`:62`).
- `begin/commit/rollback/release/isActive` (`:71-92`) — **cuerpos idénticos** a `TypeOrmUnitOfWorkImpl:270-292`.
- Un único getter que construye el scoped sobre `this.queryRunner!.manager` (`:94-99`).
- Cableado: `auth.module.ts:67-72` (`useClass` + `Scope.REQUEST`, luego `useExisting` al puerto).

`AuthModule` no importa ningún módulo financiero. Es la prueba de que el patrón no cicla (PROBLEMS.md:63-64).

### 1.6 P6 — la duplicación es literal

| | `ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod` | `ScopedExpenseChecker.sumExpenseAmountInPeriod` |
| --- | --- | --- |
| Ubicación | `unit-of-work.impl.ts:57-90` | `unit-of-work.impl.ts:220-242` |
| Firma | `(userId, categoryId, month, year) => Promise<number>` | idéntica, mismos nombres de parámetro |
| Cuerpo | `monthPeriod(year, month)` → `.select('COALESCE(SUM(e.amount), 0)', 'total').from('v_period_expenses','e')` + 4 `where` idénticos → `Number(raw?.total ?? 0)` | **byte a byte igual** (`:226-241`) |
| Llamador | `create-transaction.use-case.ts:124` (tras el lock de budget en `:106`) | `update-budget-limit.use-case.ts:44` (tras el lock de budget en `:34`) |

Confirmado: misma sentencia, misma firma, mismos nombres de parámetro, misma disciplina de lock en ambos llamadores (agregado *después* del `FOR UPDATE` sobre la fila de budget). No hay ninguna asimetría semántica que justifique dos implementaciones. Análisis completo en §5.

---

## 2. La decisión de diseño: ¿de dónde saca `transactions` el repo escopado de budgets?

`CreateTransactionUseCase` seguirá necesitando `findByUserIdAndCategoryIdAndPeriod()` con `FOR UPDATE` sobre **su propio** `QueryRunner` (`create-transaction.use-case.ts:106-111`; `ITransactionUnitOfWork.ts:21` lo declara). Esa arista `transactions → budgets` es legítima y permanente.

La tensión (PROBLEMS.md:161-168): hoy `ScopedBudgetRepository` es privada al archivo del impl, y CLAUDE.md fundamenta el `FOR UPDATE` agresivo en que *"por construcción sólo se ejecutan dentro de un QueryRunner activo"*. Publicar la clase afloja esa garantía **en silencio**: `new ScopedBudgetRepository(dataSource.manager, mapper)` compila, corre, y el `FOR UPDATE` se libera al terminar el SELECT (autocommit) sin que nada falle.

### Opción A — budgets exporta la clase scoped cruda

```ts
export class ScopedBudgetRepository extends IBudgetRepository { ... }
// transactions:
new ScopedBudgetRepository(this.queryRunner!.manager, this.budgetMapper)
```

- ✅ Una sola definición del lock. Diff mínimo.
- ❌ Destruye la garantía por construcción. El constructor acepta `EntityManager`, y **todo** `EntityManager` satisface ese tipo — incluido `dataSource.manager` en autocommit. El sistema de tipos no distingue "manager transaccional" de "manager suelto".
- ❌ El modo de falla es exactamente el peor: silencioso, y sólo observable como corrupción bajo carga.

### Opción B — budgets exporta una **factory acotada** (recomendada)

```ts
// budgets/infrastructure/persistence/scoped-budget.repository.ts
class ScopedBudgetRepository extends IBudgetRepository { ... }   // NO exportada

export function createScopedBudgetRepository(
  queryRunner: QueryRunner,             // ← no EntityManager
  mapper: BudgetMapper,
): IBudgetRepository {
  if (!queryRunner.isTransactionActive) {
    throw new Error(
      'createScopedBudgetRepository requires an ACTIVE transaction: outside one, ' +
      'its FOR UPDATE locks are released at statement end and the budget-period ' +
      'invariant silently loses its serialization gate.',
    );
  }
  return new ScopedBudgetRepository(queryRunner.manager, mapper);
}
```

- ✅ **Convierte la falla silenciosa en falla ruidosa**, que es lo único que Opción A no puede hacer. Dos mecanismos independientes:
  1. **Tipo**: el parámetro es `QueryRunner`, no `EntityManager`. `dataSource.manager` ya no *compila*. Quien quiera saltarse el contrato debe escribir `dataSource.createQueryRunner()` explícitamente — deja de ser un accidente.
  2. **Runtime**: `queryRunner.isTransactionActive` (propiedad pública de la interfaz `QueryRunner` en TypeORM 0.3 — verificado en `node_modules/typeorm/query-runner/QueryRunner.d.ts:42`) valida que `startTransaction()` ya corrió. Un `QueryRunner` conectado pero sin transacción abierta —el caso realmente peligroso, porque *parece* correcto— tira excepción en la primera llamada.
- ✅ La clase sigue siendo privada a **un** archivo. La regla de CLAUDE.md no se afloja: se traslada de "privada al impl del UoW" a "privada al archivo de la factory, cuya única puerta valida el contrato". Estrictamente **más fuerte** que hoy, donde `TypeOrmUnitOfWorkImpl` construye con `this.queryRunner!.manager` sin ninguna validación (`unit-of-work.impl.ts:308-317`) — el `!` sólo cubre el caso "olvidé `begin()`", no "manager equivocado".
- ✅ **Generalizable sin cambios**: `createScopedAccountRepository(qr, mapper)` es el mismo molde para el agente hermano; también `createScopedExpenseChecker(qr)`. Es una regla del repo, no un parche para budgets.
- ✅ Habilita P5 de forma incremental: el tipo de retorno de la factory es el punto exacto donde después se estrecha a un puerto de comando acotado (`IScopedBudgetRepository` con sólo `findByUserIdAndCategoryIdAndPeriod`), sin tocar a nadie más. Hoy se devuelve `IBudgetRepository` completo para no ampliar el alcance.
- ❌ Un archivo y ~8 líneas más que la Opción A. Costo despreciable.

### Opción C — transactions mantiene una copia privada

- ✅ Cero superficie pública nueva; la garantía por construcción intacta en ambos módulos.
- ❌ **Dos fuentes de verdad para el mutex lógico del invariante de período.** Si alguien cambia el modo de lock, el orden de columnas de la tupla natural, o agrega un `WHERE` en una copia y no en la otra, el invariante se rompe *sólo bajo concurrencia* y sólo en uno de los dos caminos. Es exactamente la deriva que PROBLEMS.md:145-147 identifica como el costo de P2, y el mismo patrón de fallo que `isBudgetable` (CLAUDE.md, anti-patrones).
- ❌ Ningún test puede detectar la divergencia: los unit tests mockean los puertos y los de integración ejercitan un camino a la vez.
- ❌ No generaliza: aplicada también a accounts, duplicaría el lock de la fila de cuenta (mecanismo de la Race 2) en dos archivos.

### Recomendación: **Opción B**

Regla generalizable a proponer para CLAUDE.md:

> **Toda clase escopada es privada a su archivo. Cuando otro módulo la necesita, el módulo dueño
> exporta una factory `createScopedX(queryRunner, deps): IX` — nunca la clase ni un constructor
> que acepte `EntityManager`. La factory valida `queryRunner.isTransactionActive` y es la única
> puerta. Los `FOR UPDATE` viven en el módulo dueño del agregado que bloquean.**

La factory no es ceremonia: es lo que reemplaza la garantía que hoy da la privacidad de archivo. Sin ella, la Opción A cambia una garantía estructural por una convención no verificable.

---

## 3. Demostración de que el modelo de locks se conserva (sección crítica)

### 3.1 El teorema a preservar

> Para todo flujo que mutase el invariante `Σ gastos del período ≤ límite`, el `FOR UPDATE` sobre
> la fila de `budgets` y el agregado subsiguiente (`SUM`/`COUNT` sobre `v_period_expenses`) deben
> ejecutarse sobre el **mismo `EntityManager`** — es decir el mismo `QueryRunner`, la misma
> transacción de Postgres — y en ese **orden**.

Si se rompe, Race 1 (`DELETE /budgets/:id` vs `POST /transactions`) y B4 (`PATCH /budgets/:id/limit` vs `POST /transactions`) se reabren sin que ningún test unitario falle.

### 3.2 Por qué el split no puede romperlo: la propiedad es *intra-instancia*

La propiedad "ambas queries comparten `EntityManager`" se materializa en **un solo lugar**: los dos getters de una misma instancia de UoW leen el mismo campo privado.

Hoy (`unit-of-work.impl.ts`):
```ts
private queryRunner: QueryRunner | null = null;              // :259
getScopedBudgetRepository()  { ... this.queryRunner!.manager ... }   // :308-313
getScopedExpenseChecker()    { ... this.queryRunner!.manager ... }   // :315-317
```

Tras el split (`BudgetUnitOfWorkImpl`), la forma es idéntica: **un** campo `queryRunner`, **dos** getters que lo leen. Lo único que cambia es qué clase declara el campo y en qué módulo vive el archivo.

El `useExisting` de `transactions.module.ts:63-74` sólo importa cuando un consumidor resuelve **dos tokens distintos** en un request y espera que compartan `QueryRunner`. Por §1.4, **ningún use case lo hace**. `DeleteBudgetUseCase` inyecta un único `IBudgetUnitOfWork` (`delete-budget.use-case.ts:13`) y llama a sus dos getters (`:21`, `:33`) — el aliasing cross-módulo nunca participó en esa igualdad de managers.

Corolario: la garantía que se está moviendo es la del *campo compartido dentro de la instancia*, no la del *token compartido entre módulos*. El split no la toca.

### 3.3 Race 1 — `DELETE /budgets/:id` vs `POST /transactions`, paso a paso post-refactor

**Request X (`DELETE /budgets/:id`)** — `BudgetsController` → `DeleteBudgetUseCase`, token `IBudgetUnitOfWork` → resuelve a `BudgetUnitOfWorkImpl` (`Scope.REQUEST`, provider en `budgets.module.ts`).

| Paso | Código (post-refactor) | Efecto en Postgres |
| --- | --- | --- |
| 1 | `uow.begin()` — cuerpo copiado literal de `auth-unit-of-work.impl.ts:71-75` | `createQueryRunner()` → conexión dedicada **QR_X**; `startTransaction()` → **TX_X** |
| 2 | `getScopedBudgetRepository()` → `createScopedBudgetRepository(this.queryRunner!, mapper)` | manager = `QR_X.manager`; la factory verifica `isTransactionActive === true` |
| 3 | `budgetRepo.findById(id)` — cuerpo movido sin cambios (`lock: { mode: 'pessimistic_write' }`, hoy `unit-of-work.impl.ts:145-151`) | `SELECT … FROM budgets WHERE id=$1 FOR UPDATE` dentro de TX_X. **El lock se mantiene hasta el COMMIT de TX_X**, no hasta que retorna el `findOne` |
| 4 | `getScopedExpenseChecker()` → `createScopedExpenseChecker(this.queryRunner!)` | manager = **`QR_X.manager`** — el *mismo* campo leído en el paso 2 |
| 5 | `hasExpensesInPeriod(...)` — cuerpo movido sin cambios | `COUNT(*) FROM v_period_expenses …` dentro de **TX_X**, con el lock del paso 3 vigente |
| 6 | `budgetRepo.delete(id)` + `commit()` | DELETE + COMMIT; recién ahí se libera el lock |

**Request Y (`POST /transactions`, gasto)** — `TransactionsController` → `CreateTransactionUseCase`, token `ITransactionUnitOfWork` → `TypeOrmUnitOfWorkImpl` (sin cambios funcionales).

| Paso | Código | Efecto |
| --- | --- | --- |
| 1 | `uow.begin()` (`create-transaction.use-case.ts:89`) | **QR_Y** / **TX_Y** |
| 2 | `getScopedBudgetRepository()` (`:97`) → `createScopedBudgetRepository(this.queryRunner!, this.budgetMapper)` | manager = `QR_Y.manager` |
| 3 | `findByUserIdAndCategoryIdAndPeriod(...)` (`:106`) | `SELECT … FROM budgets WHERE user_id=… AND category_id=… AND month=… AND year=… FOR UPDATE` en TX_Y |
| 4 | `sumExpense…` (`:124`) | agregado sobre `v_period_expenses` en TX_Y |

**Dónde ocurre realmente la serialización entre X e Y:** en el paso 3 de ambos, sobre la **misma fila de `budgets`** (misma PK; X la alcanza por `id`, Y por la tupla natural `(user_id, category_id, month, year)` — que es `UQ_budgets_user_category_period`, `budget.orm.entity.ts:14-19` — ambas resuelven a la misma fila física). Postgres bloquea al segundo en llegar hasta que el primero commitea o hace rollback.

**Esto ya era cross-transacción antes del refactor.** Con `Scope.REQUEST` (`unit-of-work.impl.ts:254`), X e Y ya tenían instancias, `QueryRunner`s, conexiones y transacciones **distintas** (PROBLEMS.md:28-41). Lo único que los serializaba era el row lock. El split cambia la *clase* que crea QR_X; no cambia que QR_X ≠ QR_Y ni que ambos piden `FOR UPDATE` sobre la misma fila.

Los desenlaces que el test de la línea 447 exige siguen siendo los dos únicos posibles:
- X gana el lock → borra el budget → COMMIT → Y desbloquea, `findByUserIdAndCategoryIdAndPeriod` devuelve `null` → `BudgetRequiredForExpenseTransactionException` → **409** (`create-transaction.use-case.ts:113-119`).
- Y gana el lock → crea el gasto → COMMIT → X desbloquea, `hasExpensesInPeriod` ve la fila commiteada (READ COMMITTED toma snapshot fresco por sentencia tras desbloquear) → `BudgetHasTransactionsInPeriodException` → **409** (`delete-budget.use-case.ts:42-48`).

### 3.4 B4 — `PATCH /budgets/:id/limit` vs `POST /transactions`

Idéntico al §3.3 sustituyendo el paso 5 por `sumExpenseAmountInPeriod` (`update-budget-limit.use-case.ts:44`) y la comparación `limit < spentInPeriod` (`:51`). El agregado sigue corriendo en TX_X, después del `FOR UPDATE` del paso 3, sobre `QR_X.manager`. Los dos desenlaces del test de la línea 224 (`patchWon`: 200 + 422; `postWon`: 409 + 201) se conservan por la misma razón.

### 3.5 Tests de límite bajo concurrencia (líneas 117 y 179)

Ambos ejercitan **sólo** `CreateTransactionUseCase`: budget lock vía `getScopedBudgetRepository()` (`:97,106`) y sum vía `getScopedTransactionRepository()` (`:92,124`) — o vía `getScopedExpenseChecker()` tras P6 (§5). Los dos getters siguen leyendo `this.queryRunner` de `TypeOrmUnitOfWorkImpl`, cuya estructura no cambia. El test de la línea 179 (período vacío) es el más sensible: sin el lock de fila de budget, las 5 requests leen `sum=0` y las 5 pasan. Es el detector más confiable de una pérdida de `FOR UPDATE`.

### 3.6 Las tres condiciones que habría que violar para romper el modelo

1. **Que un getter construya el scoped sobre un manager distinto.** Imposible por construcción: ambos getters de `BudgetUnitOfWorkImpl` reciben `this.queryRunner!`, un solo campo. Reforzado por la validación de la factory (§2, Opción B).
2. **Que el `lock: { mode: 'pessimistic_write' }` desaparezca en el movimiento.** Mitigado exigiendo que los commits 1 y 2 sean **movimientos puros** verificables por diff (§7.1) y por el test de la línea 179.
3. **Que alguien invierta el orden (agregado antes del lock).** Ningún cambio de este plan toca el cuerpo de los use cases; el orden vive en `delete-budget.use-case.ts:26→33`, `update-budget-limit.use-case.ts:34→42` y `create-transaction.use-case.ts:106→124`, y los tres quedan intactos (§6).

---

## 4. Cambios archivo por archivo, en orden de aplicación

### 4.1 Commit 1 — mover `ScopedExpenseChecker` a budgets (movimiento puro, sin cambio de DI)

**Nuevo:** `src/modules/budgets/infrastructure/persistence/scoped-expense-checker.ts`
- `class ScopedExpenseChecker extends IExpenseChecker` — cuerpo **copiado literal** de `unit-of-work.impl.ts:188-243`, comentarios de lock incluidos (son el activo documental del repo).
- **No exportar la clase.** Exportar sólo:
  ```ts
  export function createScopedExpenseChecker(queryRunner: QueryRunner): IExpenseChecker
  ```
  con la guarda `isTransactionActive` de §2.
- Imports: `IExpenseChecker` (`../../domain/repository/expense-checker.port`), `monthPeriod` (`../../../../shared/domain/month-period`), `EntityManager`/`QueryRunner` de typeorm. **Ningún import de transactions** → no se crea ciclo a nivel de archivo.

**Editar:** `src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts`
- Borrar `:188-243` (la clase).
- `:315-317`: `getScopedExpenseChecker()` → `return createScopedExpenseChecker(this.queryRunner!);`
- Añadir el import de la factory.

**Editar:** `src/modules/budgets/domain/repository/expense-checker.port.ts:1-3` — reescribir el comentario: el puerto y su implementación viven ambos en budgets; el motivo de su existencia pasa a ser que `transactions` la **consume** (dirección `transactions → budgets`), no que la implemente.

Estado tras el commit: DI sin cambios, `TypeOrmUnitOfWorkImpl` sigue satisfaciendo los tres puertos, la app se comporta idénticamente. **Punto de rollback limpio.**

### 4.2 Commit 2 — extraer `createScopedBudgetRepository` (movimiento puro)

**Nuevo:** `src/modules/budgets/infrastructure/persistence/scoped-budget.repository.ts`
- `class ScopedBudgetRepository extends IBudgetRepository` — cuerpo literal de `unit-of-work.impl.ts:134-186`, **con los comentarios de lock de `:142-144` y `:160-163` intactos** (son la única documentación in-situ del mutex lógico).
- Exportar sólo `createScopedBudgetRepository(queryRunner: QueryRunner, mapper: BudgetMapper): IBudgetRepository`.

**Editar:** `unit-of-work.impl.ts`
- Borrar `:134-186`.
- `:308-313`: `getScopedBudgetRepository()` → `return createScopedBudgetRepository(this.queryRunner!, this.budgetMapper);`
- Limpiar imports que quedan sin uso: `BudgetOrmEntity` (`:16`) y `Budget` (`:18`). **Conservar** `BudgetMapper` (`:17`, se sigue inyectando en `:265` y se pasa a la factory) e `IBudgetRepository` (`:8`, tipo de retorno del getter).

Estado: DI sin cambios. **Punto de rollback limpio.**

### 4.3 Commit 3 — `BudgetUnitOfWorkImpl` y recableado (el P1 propiamente dicho)

**Nuevo:** `src/modules/budgets/infrastructure/persistence/budget-unit-of-work.impl.ts` — molde exacto de `auth-unit-of-work.impl.ts:60-100`:

```ts
@Injectable({ scope: Scope.REQUEST })
export class BudgetUnitOfWorkImpl extends IBudgetUnitOfWork {
  private queryRunner: QueryRunner | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mapper: BudgetMapper,
  ) { super(); }

  // begin/commit/rollback/release/isActive — cuerpos idénticos a auth-unit-of-work.impl.ts:71-92

  getScopedBudgetRepository(): IBudgetRepository {
    return createScopedBudgetRepository(this.queryRunner!, this.mapper);
  }
  getScopedExpenseChecker(): IExpenseChecker {
    return createScopedExpenseChecker(this.queryRunner!);
  }
}
```

Notas de implementación:
- `extends IBudgetUnitOfWork` (no `implements`): `IBudgetUnitOfWork` es `abstract class` (`IBudgetUnitOfWork.ts:5`) y sirve de token de DI. Mismo criterio que `AuthUnitOfWorkImpl extends IAuthUnitOfWork` (`auth-unit-of-work.impl.ts:61`). `TypeOrmUnitOfWorkImpl` usa `implements` para los otros dos sólo porque ya `extends ITransactionUnitOfWork` (`:256-257`).
- **Los dos getters leen el mismo `this.queryRunner`** — es literalmente la línea de código que sostiene §3.

**Editar `src/modules/budgets/budgets.module.ts`:**
| Línea | Acción |
| --- | --- |
| `:1` | `import { Module, forwardRef }` → `import { Module, Scope }` |
| `:17` | borrar `import { TransactionsModule } …` |
| `:23` | borrar `forwardRef(() => TransactionsModule)` de `imports` |
| nuevos imports | `IBudgetUnitOfWork` (`./domain/IBudgetUnitOfWork`), `BudgetUnitOfWorkImpl` |
| `:26-37` providers | añadir `{ provide: BudgetUnitOfWorkImpl, useClass: BudgetUnitOfWorkImpl, scope: Scope.REQUEST }` y `{ provide: IBudgetUnitOfWork, useExisting: BudgetUnitOfWorkImpl }` |
| `:38` exports | **sin cambios** — `GetBudgetByUserCategoryPeriodUseCase` y `BudgetMapper` los sigue necesitando transactions |

Tras esto, `imports` de budgets queda `[TypeOrmModule.forFeature([BudgetOrmEntity]), CategoriesModule]`. **La arista `budgets → transactions` desaparece.**

**Editar `src/modules/transactions/transactions.module.ts`:**
| Línea | Acción |
| --- | --- |
| `:15` | borrar `import { IBudgetUnitOfWork } …` |
| `:34` | `forwardRef(() => BudgetsModule)` → `BudgetsModule` (actualizar el comentario: además del use case, provee `BudgetMapper`) |
| `:57` | actualizar el comentario (ya no menciona `IBudgetUnitOfWork`) |
| `:67-70` | borrar el provider `{ provide: IBudgetUnitOfWork, useExisting: TypeOrmUnitOfWorkImpl }` |
| `:76` | `exports: [ITransactionUnitOfWork, IAccountUnitOfWork]` |
| `:1` | **conservar `forwardRef`** — lo sigue usando `:32` para `AccountsModule` (alcance del agente hermano) |

**Editar `unit-of-work.impl.ts`:**
- `:4` borrar `import { IBudgetUnitOfWork } …`
- `:257` `implements IBudgetUnitOfWork, IAccountUnitOfWork` → `implements IAccountUnitOfWork`
- `:315-317` borrar `getScopedExpenseChecker()` — queda sin puerto que lo declare y sin consumidor. **El commit 4 lo reintroduce** sobre `ITransactionUnitOfWork` (§5). Si se decide no hacer P6, este getter se borra definitivamente y `createScopedExpenseChecker` queda con un solo consumidor (budgets).
- `:247-253` actualizar el docblock ("satisfies BOTH module-specific ports").

**Editar `src/modules/transactions/infrastructure/persistence/__fakes__/in-memory-unit-of-work.ts`:** ningún cambio obligatorio en este commit (su `implements IBudgetUnitOfWork` de `:10` sigue compilando y sigue sin usarse desde budgets; se limpia en el commit 4).

### 4.4 Fuera de alcance, explícito

`transactions.module.ts:32` (`forwardRef(() => AccountsModule)`) y `accounts.module.ts:29` **no se tocan**. El ciclo `accounts ↔ transactions` sobrevive a este plan por diseño; lo cierra el agente hermano con el mismo molde (factory `createScopedAccountRepository` + `AccountUnitOfWorkImpl`).

Tras este plan, el grafo queda:
```
transactions ──> budgets ──> categories        (sin ciclo, sin forwardRef)
transactions ──> accounts,  accounts ─.forwardRef.─> transactions   (pendiente: agente hermano)
```

### 4.5 Documentación a actualizar en el mismo PR (regla de CLAUDE.md)

| Archivo | Qué corregir |
| --- | --- |
| `CLAUDE.md` tabla de puertos (~`:126-131`) | `IBudgetUnitOfWork` → implementado por `BudgetUnitOfWorkImpl` |
| `CLAUDE.md` bloque `useExisting` (~`:136-140`) | quitar la línea de `IBudgetUnitOfWork` |
| `CLAUDE.md` "Scoped resources" (~`:150-160`) | separar los recursos de budgets |
| `CLAUDE.md` mapa de locking (~`:165-180`) | `ScopedBudgetRepository` / `ScopedExpenseChecker` ahora en `budgets/infrastructure` |
| `CLAUDE.md` Race 1 y B4 (~`:193`, `:200`) | mismo impl-name |
| `CLAUDE.md` anti-patrones | **añadir la regla de la factory** (§2) y la advertencia de §8.3 |
| `README.md:106` | la flecha `transactions -. IExpenseChecker / IAccountUnitOfWork .-> accounts` es doblemente incorrecta ya hoy (`IExpenseChecker` es de budgets, no de accounts); corregir |
| `docs/architecture.md:104,110,132-134,148,169` | `ScopedExpenseChecker` y `IBudgetUnitOfWork` ya no los implementa transactions |
| `docs/concurrency-model.md:59-60,83` | el impl de budgets ya no es `TypeOrmUnitOfWorkImpl` |
| `docs/adr/0003-port-owned-by-consumer.md:13-15` | `IExpenseChecker` deja de ser ejemplo de "port owned by consumer": tras el refactor el puerto **y** su impl viven en budgets. El ejemplo vivo del patrón pasa a ser la factory scoped. **Requiere un ADR nuevo o un supersede** — no un parche silencioso. |
| `src/modules/budgets/notes.md:35,50,107,121` | `:107` (*"Imports TransactionsModule (with forwardRef) to obtain IExpenseChecker"*) y `:121` quedan falsos |
| `src/modules/transactions/notes.md:115-121,144,185,214` | `:185` (*"Exports: IExpenseChecker"*) y `:121` ("tres puertos") quedan falsos |
| `docs/history/*` | **no tocar** — son registro histórico |

---

## 5. P6 — consolidar o no

### 5.1 ¿Hay alguna razón para mantenerlas separadas?

Examinado explícitamente (firmas, nombres de parámetro, llamadores — §1.6):

- **¿Semántica distinta?** No. Misma sentencia byte a byte, mismos filtros, misma fuente (`v_period_expenses`), misma conversión de borde `Number(raw?.total ?? 0)`.
- **¿Disciplina de lock distinta?** No. Ambas son agregados sin lock propio, ambas corren después del `FOR UPDATE` sobre la fila de budget que toma su llamador (`create-transaction.use-case.ts:106` → `:124`; `update-budget-limit.use-case.ts:34` → `:44`).
- **¿Dirección de dependencia?** Consumir `IExpenseChecker` desde transactions no crea ninguna arista nueva: `ITransactionUnitOfWork.ts:4` ya importa `IBudgetRepository` de `budgets/domain`.
- **¿Podrían divergir legítimamente en el futuro?** **No — y hay un test que lo prohíbe.** `test/integration/reports/summary-enforcement-equivalence.integration.spec.ts:88-126` verifica que el mismo `S` es visto por `GET /reports/summary` (`:98`), por el enforcement de `PATCH /limit` (`:105`, `:112` — que usa `sumExpenseAmountInPeriod`) y por el enforcement de `POST /transactions` (`:125` — que usa `sumExpenseAmountByUserCategoryAndPeriod`). Ese test **ya trata la divergencia como bug**. Mantener dos implementaciones es sostener una obligación de igualdad sin nada que la haga estructural.
- **¿Alguna razón de rendimiento?** No: mismo plan de ejecución, misma vista inlineada.

**Único costo real de consolidar** (y es la razón por la que va en un commit aparte): obliga a tocar los fakes y **un spec de transactions**. `create-transaction.use-case.spec.ts:41` construye `new InMemoryUnitOfWork(txRepo, accountRepo, budgetRepo)` sin cuarto argumento, y `in-memory-unit-of-work.ts:60-65` lanza `'ExpenseChecker not provided'`.

### 5.2 Decisión: **consolidar, en un commit separado y posterior al split**

Justificación: hoy la duplicación es intra-archivo (`unit-of-work.impl.ts:57-90` vs `:220-242`) — visible de un vistazo. Tras el commit 3 pasa a ser **inter-módulo**, invisible, y con la mitad del par escondida detrás de una factory. El costo de P6 sube con el refactor; hacerlo inmediatamente después es el momento más barato. No antes, porque el split es la parte riesgosa y debe verificarse aislada.

### 5.3 Commit 4 — forma concreta

1. `src/modules/transactions/domain/ITransactionUnitOfWork.ts`: añadir `abstract getScopedExpenseChecker(): IExpenseChecker;` (importado de `budgets/domain/repository/expense-checker.port`).
2. `src/modules/transactions/domain/repository/scoped-transaction.repository.ts:11-16`: borrar `sumExpenseAmountByUserCategoryAndPeriod`. El puerto queda `findByIdWithLock` / `save` / `delete` — puramente comandos sobre la fila de transacción, coherente con su docblock (`:3-8`).
3. `unit-of-work.impl.ts`: borrar `:57-90` de `ScopedTransactionRepository`; reintroducir `getScopedExpenseChecker(): IExpenseChecker { return createScopedExpenseChecker(this.queryRunner!); }`. Tras esto `monthPeriod` (`:19`) queda sin uso en el archivo → borrar el import.
4. `create-transaction.use-case.ts:123-129`: `txRepo.sumExpenseAmountByUserCategoryAndPeriod(...)` → `this.uow.getScopedExpenseChecker().sumExpenseAmountInPeriod(...)`. **Mantener la posición exacta**: después de `findByUserIdAndCategoryIdAndPeriod` (`:106`), antes del `if (projectedSpent > limit)` (`:134`). Conservar el comentario `NO LOCK / aggregate read` de `:121-122`.
5. `__fakes__/in-memory-transaction.repository.ts:50-69`: renombrar el método a `sumExpenseAmountInPeriod`, añadir `hasExpensesInPeriod` delegando, y declarar `implements IExpenseChecker`. El doble rol ya está admitido en su propio docblock (`:8-10`).
6. `__fakes__/in-memory-unit-of-work.ts`: quitar `implements IBudgetUnitOfWork` (`:10`) y su import (`:2`) — los cuatro getters pasan a pertenecer todos a `ITransactionUnitOfWork`.
7. `create-transaction.use-case.spec.ts:41`: `new InMemoryUnitOfWork(txRepo, accountRepo, budgetRepo, txRepo)`.

**El lock model no cambia:** el checker se construye sobre `this.queryRunner!` de `TypeOrmUnitOfWorkImpl` — el mismo `QueryRunner` sobre el que se tomó el `FOR UPDATE` del budget en `:106`. Es exactamente la composición que §2 habilita.

**Nota P5:** transactions pasa a ver `hasExpensesInPeriod`, que no necesita. Es sobre-exposición menor (2 métodos, uno sobrante) y cae dentro de P5; no se resuelve aquí para no ampliar el alcance.

Si se decide **diferir P6**: no hacer nada en el commit 3 más allá de borrar el getter huérfano, y anotar la duplicación en `PROBLEMS.md` como "ahora inter-módulo, prioridad subida".

---

## 6. Qué NO debe cambiar

### 6.1 Los dos use cases de budgets: **cero líneas modificadas**

`delete-budget.use-case.ts` y `update-budget-limit.use-case.ts` inyectan `IBudgetUnitOfWork` — **el mismo token, en la misma posición del constructor** (`:13` y `:21`). Lo único que cambia es qué provider está detrás del token, y eso es invisible desde el use case: sigue llamando `begin()`, `getScopedBudgetRepository()`, `getScopedExpenseChecker()`, `commit()`, `rollback()`, `release()` con la misma firma. **Es la prueba de que P1 es un cambio de composición, no de lógica.**

### 6.2 Sus `.spec.ts`: **cero líneas modificadas**

- `delete-budget.use-case.spec.ts:25-38` construye un `makeMockUow` como objeto plano con `jest.fn()` y lo castea (`:52`, `:67`, `:82`, `:96`). Nunca referencia `TypeOrmUnitOfWorkImpl`.
- `update-budget-limit.use-case.spec.ts:30-47` usa `Partial<IBudgetUnitOfWork>` con la misma técnica; `FakeExpenseChecker` (`:14`) extiende el puerto de budgets, que no se mueve.

Ninguno importa nada de `transactions`. Siguen pasando sin tocarse.

> Si en algún momento el plan obligara a modificar estos cuatro archivos, sería señal de que el
> refactor se salió de "cambio de composición" a "cambio de contrato" — y habría que parar y
> revisar. **No es el caso.**

### 6.3 Tampoco cambian

- Los puertos `IBudgetUnitOfWork.ts` e `expense-checker.port.ts` (salvo el comentario de §4.1). Firmas idénticas.
- Los cuerpos de `ScopedBudgetRepository` y `ScopedExpenseChecker`, incluidos sus comentarios de lock.
- `BudgetsController`, `BudgetRepositoryImpl`, `BudgetMapper`, `BudgetOrmEntity`, la caché.
- `reports/` en su totalidad — no participa.
- Cualquier archivo de test bajo `test/integration/`.
- Las migraciones. `v_period_expenses` (`1783292601885-CreatePeriodExpensesView.ts`) no se toca; el comentario `:7-9` ("los 3 agregados de enforcement en TypeOrmUnitOfWorkImpl") pasa a ser deriva menor → actualizar.

---

## 7. Verificación

### 7.1 Por commit

**Commits 1 y 2 — verificar que son movimientos puros.** Ningún test detecta la pérdida de un `lock: { mode: 'pessimistic_write' }` de forma determinista, así que la primera línea de defensa es el diff:

```bash
git show <sha> -- '*scoped-expense-checker.ts' '*unit-of-work.impl.ts' | grep -E '^[+-].*(pessimistic|lock:|FROM|from\()'
```
Debe mostrar cada línea de lock/consulta exactamente una vez como `-` y una vez como `+`. Cero cambios netos en los cuerpos.

Además, tras cada commit:
```bash
npm run lint && npm test && npm run test:integration
```

**Commit 3 — el oráculo.** `test/integration/concurrency/concurrency.integration.spec.ts` debe pasar **sin modificarse**:

| Línea | Escenario | Qué falsaría |
| --- | --- | --- |
| `:117` | N gastos concurrentes con $90 previos | `successes ≤ 2` (`:158`). Sin lock: hasta 5 pasan |
| `:179` | **Período vacío** — el más sensible | `successes === 1` (`:204`). Sin el lock de la fila de budget, las 5 leen `sum=0` y las 5 pasan. Es el detector con menos dependencia del timing |
| `:224` | B4 — PATCH limit vs POST | `patchWon \|\| postWon` (`:271`) + el balance esperado (`:280`) |
| `:447` | Race 1 — DELETE budget vs POST | `deleteWon \|\| createWon` (`:471`) + balance (`:478`) |

Verificaciones estructurales adicionales del commit 3:
```bash
grep -rn "transactions" src/modules/budgets/ --include=*.ts     # debe dar 0
grep -n "IBudgetUnitOfWork" src/modules/transactions/           # sólo el fake (hasta el commit 4)
```
Y arranque real: `npm run start:dev` debe bootear sin `forwardRef` entre budgets y transactions.

**Commit 4 (P6).** Los cuatro escenarios de concurrencia otra vez (el `:117`/`:179` ahora ejercitan el checker en vez del repo de transacciones), más:

`test/integration/reports/summary-enforcement-equivalence.integration.spec.ts` — **directamente relevante**, porque P6 cambia qué método usa el enforcement de `POST /transactions`. El test usa tres sondas sobre el mismo `S = 600`: `summary.body.expenses === S` (`:98`), `PATCH limit = S` → 200 (`:105`), `PATCH limit = S-1` → 409 (`:112`), `POST expense` → 422 (`:125`). La sonda `:125` es la que atraviesa el método consolidado. Si la consolidación cambiara la semántica de la suma, esa sonda rompe. **Debe pasar sin modificarse.** (Nota: el commit 3 no altera ninguna consulta, así que ahí sólo actúa como regresión de fondo.)

### 7.2 Detección positiva del `FOR UPDATE` (recomendada, una vez)

Los tests de concurrencia son dependientes del timing: en una máquina rápida podrían serializar por accidente. Al menos una vez tras el commit 3, correr con logging de SQL y confirmar visualmente el lock:

```bash
DB_LOGGING=true npm run test:integration -- concurrency 2>&1 | grep -i "FOR UPDATE"
```
Debe aparecer `FOR UPDATE` sobre `"budgets"` (nombre de tabla confirmado en `budget.orm.entity.ts:13`) en ambos caminos: el de `DeleteBudget`/`UpdateBudgetLimit` (por `id`) y el de `CreateTransaction` (por la tupla natural).

### 7.3 Criterio de "funcionó" (PROBLEMS.md:130-131)

1. Los cuatro escenarios de concurrencia pasan sin modificar el archivo de test.
2. `budgets.module.ts` no importa `transactions`.
3. No queda ningún `forwardRef` entre budgets y transactions.
4. La suite unitaria pasa sin tocar los specs de `DeleteBudget` / `UpdateBudgetLimit`.

---

## 8. Riesgos y modos de falla silenciosos

### 8.1 Pérdida de `FOR UPDATE` en el movimiento — **el riesgo principal**

Un `lock: { mode: 'pessimistic_write' }` que no se copia no rompe ningún tipo, no rompe ningún unit test (mockean los puertos), y sólo se manifiesta como corrupción del invariante bajo concurrencia real.

*Detección:* diff normalizado (§7.1) + test de la línea 179 + grep de `FOR UPDATE` en el log SQL (§7.2). *Mitigación estructural:* commits 1 y 2 son movimientos puros, sin ningún otro cambio mezclado, de modo que el diff sea auditable a ojo.

### 8.2 Un scoped construido sobre un manager en autocommit

El `FOR UPDATE` se emite, Postgres lo concede, y lo libera al terminar el SELECT. Todo "funciona"; la serialización desaparece. Nada falla nunca.

*Mitigación:* es precisamente lo que la Opción B convierte en imposible-por-tipo (parámetro `QueryRunner`, no `EntityManager`) y en ruidoso-por-runtime (`isTransactionActive`). Sin la factory, este riesgo **crece** respecto de hoy, porque la clase deja de ser privada al archivo. **Es la razón por la que la factory no es opcional.**

### 8.3 Riesgo **nuevo** que introduce el split: dos UoW en un mismo request

Hoy, `useExisting` (`transactions.module.ts:63-74`) garantiza que si alguien inyectara `IBudgetUnitOfWork` y `ITransactionUnitOfWork` en el mismo use case, ambos serían la **misma** instancia → un `QueryRunner`. Tras el split serían **dos** instancias, dos conexiones, dos transacciones. Un use case así podría **auto-bloquearse**: TX_A toma `FOR UPDATE` sobre una fila y TX_B (mismo request, misma pila de `await`) la pide → espera indefinida hasta el timeout del pool/lock, con la request colgada.

Hoy no ocurre (§1.4), pero pasa de "estructuralmente imposible" a "posible si alguien lo escribe". Además consumiría 2 de las `DB_POOL_MAX` conexiones (default 10, `app.module.ts:129`) por request.

*Mitigación:* documentarlo explícitamente en CLAUDE.md como anti-patrón —**"un use case inyecta como máximo un puerto de UoW; si necesita coordinar dos agregados, el UoW dueño de la frontera multi-agregado (`transactions`) compone los scoped de los vecinos"**— y como criterio de code review. Es un riesgo de proceso, no de código.

### 8.4 Deriva documental

Doce ubicaciones afirman que `TypeOrmUnitOfWorkImpl` implementa `IBudgetUnitOfWork` o que `ScopedExpenseChecker` vive en transactions (§4.5). Ningún test las verifica. `docs/adr/0003-port-owned-by-consumer.md` pierde su ejemplo canónico y necesita un ADR nuevo o un supersede explícito, no un parche.

*Detección:* `grep -rn "TypeOrmUnitOfWorkImpl\|ScopedExpenseChecker" --include=*.md .` (excluyendo `docs/history/`) debe quedar consistente con el código antes de mergear.

### 8.5 Riesgo bajo o nulo

- **Scope de DI (P3):** `BudgetsController` ya es `Scope.REQUEST` hoy, vía `DeleteBudgetUseCase → IBudgetUnitOfWork → TypeOrmUnitOfWorkImpl(REQUEST)`. Tras el split la cadena es idéntica con el provider local. **El perfil de P3 no cambia** — este refactor no lo mejora ni lo empeora (PROBLEMS.md:199-200).
- **`BudgetMapper` en transactions:** `TypeOrmUnitOfWorkImpl` lo inyecta (`:265`) y lo obtiene de `BudgetsModule`, que lo exporta (`budgets.module.ts:38`). El export se conserva; transactions sigue importando `BudgetsModule` (ahora sin `forwardRef`). Sin cambio.
- **`BudgetOrmEntity` fuera del `forFeature` de budgets:** los scoped usan `manager.findOne(BudgetOrmEntity, …)`, que resuelve por metadata del `DataSource` (`autoLoadEntities: true`, `app.module.ts:112`), no por el `forFeature` del módulo. Los scoped de transactions ya lo hacían así. Sin cambio.
- **Ciclo a nivel de archivo:** los nuevos archivos de budgets importan sólo de `budgets/domain`, `shared/domain` y typeorm. `transactions/…/unit-of-work.impl.ts` importa de `budgets/infrastructure`. Arista única, sin retorno.

---

## 9. Orden de commits y punto de rollback

| # | Commit | Alcance | Verde tras | Revertible solo |
| --- | --- | --- | --- | --- |
| 0 | *(otro agente)* **P7** — sacar la invalidación de caché del `try` | `delete-budget.use-case.ts`, `update-budget-limit.use-case.ts` | suite completa | sí |
| 1 | `refactor(budgets): move ScopedExpenseChecker out of the transactions UoW` | nuevo `scoped-expense-checker.ts`; `unit-of-work.impl.ts:188-243,315-317`; comentario del puerto | unit + integración | **sí — punto de rollback** |
| 2 | `refactor(budgets): extract createScopedBudgetRepository behind a guarded factory` | nuevo `scoped-budget.repository.ts`; `unit-of-work.impl.ts:134-186,308-313` | unit + integración | **sí — punto de rollback** |
| 3 | `refactor(budgets): own the budget unit of work; drop the forwardRef to transactions` | nuevo `budget-unit-of-work.impl.ts`; `budgets.module.ts`; `transactions.module.ts`; `unit-of-work.impl.ts:4,257,315-317` + docs | **concurrencia (117/179/224/447) + boot real** | sí |
| 4 | `refactor(transactions): consume the budgets expense checker (P6)` | puertos, `create-transaction.use-case.ts:123-129`, fakes, 1 spec | concurrencia + equivalencia reports | sí, independiente de 1-3 |

**Puntos de rollback y por qué están ahí:**
- **Tras el commit 2** es el punto de rollback de mayor valor: todo el código de locks ya está en su módulo definitivo detrás de factories validadas, y **el grafo de DI aún no cambió**. Si el commit 3 falla (boot, DI, resolución de scope), se revierte solo el 3 y queda un estado mejor que el inicial: P2 resuelto (código de lock en su módulo dueño) sin haber tocado P1.
- **El commit 3 es la única transición irreversible en un sentido operativo**: cambia el grafo de módulos. Si algo falla en producción, se revierte el commit 3 aislado y `TypeOrmUnitOfWorkImpl` recupera los tres puertos con los cuerpos ya movidos (basta reponer el provider, el `implements` y el `forwardRef`).
- **El commit 4 (P6)** es ortogonal: se puede aplicar, revertir o diferir sin tocar 1-3.

**Regla de disciplina:** los commits 1 y 2 no deben contener **ningún** cambio funcional. Si el diff muestra algo que no sea "mismas líneas, otro archivo, más la factory", hay que dividirlo.

---

## 10. Coordinación con el plan de P7

**Supuesto: P7 va primero** (es el único defecto de comportamiento del inventario, PROBLEMS.md:294-329).

Los dos planes tocan los mismos dos archivos, pero **regiones disjuntas**:

| Archivo | P7 toca | Este plan toca |
| --- | --- | --- |
| `delete-budget.use-case.ts` | `:50-62` — mover el `Promise.all` de invalidación de caché fuera del `try`/después del `finally` | **nada** |
| `update-budget-limit.use-case.ts` | `:62-75` — lo mismo con el `Promise.all` y el `return updated` | **nada** |

**Este plan modifica cero líneas de ambos archivos** (§6.1): el token inyectado (`IBudgetUnitOfWork`), su posición en el constructor y las llamadas a los getters permanecen idénticos; sólo cambia el provider detrás del token, en `budgets.module.ts`.

**Conflicto de merge: imposible.** El único punto de contacto sería el import de `IBudgetUnitOfWork` (`delete-budget.use-case.ts:2`, `update-budget-limit.use-case.ts:2`), que ninguno de los dos planes modifica.

**Orden recomendado:** P7 → commits 1-4 de este plan → (en paralelo o después) el plan de accounts. Si por alguna razón este plan se aplicara primero, el resultado es el mismo: P7 seguiría aplicándose limpiamente, porque el bloque `try/catch/finally` que reescribe queda intacto.
