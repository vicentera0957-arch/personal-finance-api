# PLAN — P5: puertos de comando acotados para los agregados vecinos

> Referencia: `src/PROBLEMS.md` §P5. Plan hermano vivo: `src/PLAN-P7-cache-rollback.md`.
> Este documento no repite el enunciado de P5: aporta la derivación de la capacidad real, la forma
> y ubicación de los puertos, el impacto exacto del rename, y una verificación **a nivel de tipos**.
>
> **La premisa de este plan ya se cumplió.** La Opción B (factory acotada que recibe `QueryRunner`,
> no `EntityManager`) está implementada en los dos módulos: `createScopedAccountRepository` y
> `createScopedBudgetRepository`, más `createScopedExpenseChecker`. Es lo que hace que P5 cueste
> ~40 líneas: **el tipo de retorno de esas tres factories es el único punto que hay que estrechar.**
> La decisión está registrada en [ADR-0009](../docs/adr/0009-scoped-repositories-as-guarded-factories.md).

> **Nota de referencias.** Este plan cita `PLAN-P1P2-accounts.md` y `PLAN-P1P2-budgets.md` con
> números de sección y de línea. Esos archivos ya no existen: el trabajo que describían está
> implementado y se borraron al cerrarse P1 y P2. Las citas se conservan porque el razonamiento
> sigue siendo válido, pero **no las sigas a ciegas** — para el estado real mirá el código, o
> recuperá el texto original con `git show ba62266:src/PLAN-P1P2-budgets.md`.
>
> Commits que cerraron esos planes: `91de97b` · `b026ac8` · `19eed72` (accounts) y
> `83d4c15` · `dc35dc7` · `ac40f03` · `b140cf4` (budgets).
>
> Dos supuestos del plan que cambiaron: (1) las clases scoped ya **no** viven en
> `unit-of-work.impl.ts` — están en `accounts/` y `budgets/infrastructure/persistence/`, cada una
> con su spec que afirma el `FOR UPDATE`; (2) `IExpenseChecker` se movió de
> `budgets/domain/repository/` a `budgets/domain/ports/`, porque responde una consulta derivada y
> no un ciclo de vida de persistencia.

---

## 0. Estado del que parte este plan

P5 se planifica **sobre el estado post-P1/P2**, donde ya existen (planeados, aún no escritos):

| Artefacto | Plan que lo crea | Origen actual |
| --- | --- | --- |
| `accounts/infrastructure/persistence/scoped-account.repository.ts` | `PLAN-P1P2-accounts.md` §4 Paso 1 | clase privada en `transactions/infrastructure/persistence/unit-of-work.impl.ts:97-132` |
| `accounts/infrastructure/persistence/account-unit-of-work.impl.ts` | ídem, Paso 2 | — |
| `budgets/infrastructure/persistence/scoped-budget.repository.ts` | `PLAN-P1P2-budgets.md` §4.2 | clase privada en `unit-of-work.impl.ts:134-186` |
| `budgets/infrastructure/persistence/scoped-expense-checker.ts` | ídem §4.1 | clase privada en `unit-of-work.impl.ts:188-243` |
| `budgets/infrastructure/persistence/budget-unit-of-work.impl.ts` | ídem §4.3 | — |

Todas las citas `archivo:línea` de este plan que apuntan a `unit-of-work.impl.ts` se refieren al
**estado actual del repo** (verificado hoy); cuando P5 se ejecute, ese código vivirá en los archivos
de la columna izquierda con el mismo cuerpo (ambos planes exigen que el movimiento sea puro).

---

## 1. Qué capacidad necesita realmente `transactions` de cada vecino

Derivado de los llamadores, no del puerto.

### 1.1 De `accounts`

Cadena completa de consumo, verificada:

| Paso | Evidencia |
| --- | --- |
| `CreateTransactionUseCase` toma el repo scoped | `create-transaction.use-case.ts:93` (`const acctRepo = this.uow.getScopedAccountRepository()`) |
| …y lo único que hace con él es construir el colaborador | `:94` (`new UpdateAccountBalanceUseCase(acctRepo)`), invocado en `:147-151` |
| `DeleteTransactionUseCase` hace lo mismo | `delete-transaction.use-case.ts:27`, `:35`, `:39-43` |
| `UpdateAccountBalanceUseCase` usa exactamente dos métodos | `update-account-balance.use-case.ts:17` (`findById`) y `:31` (`save`) |

**Capacidad necesaria: `{ leer la fila de cuenta con lock, guardar la cuenta }`.**

Verificado además que **nadie** llama a los otros dos métodos del repo scoped de cuentas:
`ScopedAccountRepository.findByUserId` (`unit-of-work.impl.ts:116-121`) y `.delete` (`:129-131`)
tienen **cero llamadores** en todo el sistema — los únicos poseedores de una instancia scoped son
`create-transaction.use-case.ts:93`, `delete-transaction.use-case.ts:27`,
`archive-account.use-case.ts:20`, `unarchive-account.use-case.ts:20` y `rename-account.use-case.ts:21`,
y ninguno los invoca. Son **código muerto**: P5 los borra.

> Dato que refuerza el borrado de `delete`: `DeleteAccountUseCase` **no usa el UoW** — inyecta el
> repo global (`delete-account.use-case.ts:12`, `:22`). Es una decisión explícita del módulo
> (`accounts/notes.md:85,87`: *"Delete doesn't mutate the balance, so it doesn't need to serialize"*).
> Que el UoW de cuentas exponga `delete()` contradice hoy esa decisión, aunque nadie la aproveche.

### 1.2 De `budgets`

| Paso | Evidencia |
| --- | --- |
| `CreateTransactionUseCase` toma el repo scoped de budgets | `create-transaction.use-case.ts:97` |
| Llama **un** método | `:106-111` (`findByUserIdAndCategoryIdAndPeriod`) |
| Del `Budget` obtenido solo **lee** | `:132` (`budget.getLimit().getValue()`) |
| No hay `save` ni `delete` sobre budgets en todo `transactions/` | verificado por grep sobre `src/modules/transactions/**` |

**Capacidad necesaria: `{ leer la fila de budget del período con lock }`.** Una sola operación, de
lectura.

Los use cases **propios** de budgets necesitan otra cosa: `findById` con lock + `save` + `delete`
(`delete-budget.use-case.ts:26`, `:50`; `update-budget-limit.use-case.ts:34`, `:62`). Y ninguno de
los tres poseedores de una instancia scoped de budgets llama a `findByUserId`
(`unit-of-work.impl.ts:153-158`) → también **código muerto**, también se borra.

**Asimetría central de este plan:** para accounts, el conjunto que necesita transactions y el que
necesita accounts es **el mismo**; para budgets son **distintos**. Eso determina la cantidad de
puertos (§3.1) — no una preferencia estética.

### 1.3 Del expense checker (solo si P6 aterrizó)

`PLAN-P1P2-budgets.md` §5.3 hace que `CreateTransaction` consuma
`getScopedExpenseChecker().sumExpenseAmountInPeriod(...)`. `IExpenseChecker`
(`expense-checker.port.ts:4-18`) declara dos métodos; transactions necesitaría solo uno —
`hasExpensesInPeriod` (`:5-10`) le sobra. El propio plan de budgets lo marcó como territorio de P5.

**Decisión: se tolera. No se parte el puerto.** Justificación en §2.

### 1.4 Fuera de alcance

`IAuthUnitOfWork.getRefreshTokenRepository(): IRefreshTokenRepository`
(`auth/domain/IAuthUnitOfWork.ts`) entrega el puerto completo, pero el consumidor
(`RefreshTokenUseCase`) es **el dueño del agregado**. Por el criterio de §2 no hay nada que
estrechar. Igual para `IScopedTransactionRepository` (`scoped-transaction.repository.ts:9-19`), que
ya nació acotado y cuyo consumidor es transactions.

---

## 2. El criterio de estrechamiento (regla generalizable)

P5 tal como está enunciado (`PROBLEMS.md:255-257`) señala el daño concreto: *"por tipo,
`CreateTransactionUseCase` puede **borrar** una cuenta o un budget dentro de su transacción"*. El
daño no es "ve métodos de más": es **poder mutar o destruir un agregado ajeno dentro de una
transacción que no le pertenece**. Una lectura sobrante no puede violar ningún invariante.

> **Regla:** un puerto escopado entrega a cada consumidor (a) las lecturas que usa, y (b) **solo las
> escrituras sobre el agregado del que ese consumidor es responsable**. Un consumidor externo al
> agregado nunca recibe `save`/`delete` de ese agregado. Las lecturas sobrantes se toleran; las
> escrituras sobrantes no. Cuando quitar una lectura sobrante es gratis (cero llamadores), se quita.

Aplicada mecánicamente:

| Consumidor | Agregado | ¿Escribe legítimamente? | Resultado |
| --- | --- | --- | --- |
| `transactions` (Create/Delete) | `Account` | **Sí** — el balance es parte del invariante multi-agregado que transactions ancla (`CLAUDE.md`, "Why the impl lives in transactions") | recibe `save`; **no** `delete` |
| `accounts` (Archive/Unarchive/Rename) | `Account` | Sí | recibe `save`; **no** `delete` (Delete corre fuera del UoW, §1.1) |
| `transactions` (Create) | `Budget` | **No** — solo lee el límite (`:132`) | **ni `save` ni `delete`** |
| `budgets` (DeleteBudget/UpdateLimit) | `Budget` | Sí | recibe `save` y `delete` |
| `transactions` (Create, post-P6) | vista `v_period_expenses` | n/a — puro read | `IExpenseChecker` completo; el método sobrante es una lectura |

Es la misma regla que ya produjo `IScopedTransactionRepository` (`scoped-transaction.repository.ts`,
docblock `:3-5`: *"the transaction surface that may only run INSIDE an open Unit of Work"*). P5 la
extiende a los vecinos, que es literalmente lo que `PROBLEMS.md:260-262` reclama.

---

## 3. Los puertos nuevos: forma y ubicación

### 3.1 Forma

**Un** puerto para accounts (los dos consumidores necesitan lo mismo), **dos** para budgets:

```ts
// accounts/domain/repository/scoped-account.repository.ts
export abstract class IScopedAccountRepository {
  abstract findByIdWithLock(id: string): Promise<Account | null>;
  abstract save(account: Account): Promise<Account>;
}
```

```ts
// budgets/domain/repository/scoped-budget.repository.ts
export abstract class IScopedBudgetRepository {
  abstract findByIdWithLock(id: string): Promise<Budget | null>;
  abstract save(budget: Budget): Promise<Budget>;
  abstract delete(id: string): Promise<void>;
}

// budgets/domain/repository/budget-period-reader.port.ts
export abstract class IScopedBudgetPeriodReader {
  abstract findByUserIdAndCategoryIdAndPeriodWithLock(
    userId: string, categoryId: string, month: number, year: number,
  ): Promise<Budget | null>;
}
```

Puntos de forma que no son negociables ni accidentales:

- **`abstract class`, no `interface`** — CLAUDE.md lo marca como no negociable por el token de DI.
  Acá los puertos nuevos **no** son tokens de DI (nunca se inyectan; los devuelve un getter del
  UoW), pero se mantiene la forma por consistencia: es exactamente lo que hace
  `IScopedTransactionRepository` (`scoped-transaction.repository.ts:9`), cuyo docblock (`:4-5`)
  aclara *"It is never a DI token"*. Copiar esa nota en los nuevos.
- **Puertos hermanos, no subtipos.** `docs/concurrency-model.md:369` propone
  `IScopedAccountRepository extends IAccountRepository`. **Esa forma no sirve para P5**: heredar del
  puerto completo arrastra `delete()` y `findByUserId()`, que es justo lo que hay que quitar. P5
  implementa la idea de §13.1 de ese documento y **corrige su forma**; hay que actualizar la línea
  (§12).
- **El puerto global no se toca.** `IAccountRepository` (`accounts/domain/repository/accounts.repository.ts:3-8`)
  e `IBudgetRepository` (`budgets/domain/repository/budgets.repository.ts:10-24`) siguen intactos:
  son la superficie de lectura/escritura **fuera** de transacción, y sus consumidores
  (`CreateAccountUseCase`, `GetAccountsByUserIdUseCase`, `DeleteAccountUseCase`,
  `GetBudgetByUserCategoryPeriodUseCase`, etc.) no cambian. La divergencia de nombres entre
  `IBudgetRepository.findByUserIdAndCategoryIdAndPeriod` (sin lock) y
  `IScopedBudgetPeriodReader.findByUserIdAndCategoryIdAndPeriodWithLock` (con lock) es **deliberada
  y es el punto**: mismo dato, distinta disciplina, nombres distintos. Precedente exacto:
  `ITransactionRepository.findById` vs `IScopedTransactionRepository.findByIdWithLock`.

### 3.2 Dónde viven: el puerto pertenece al **dueño del agregado**, no al consumidor

El coordinador pide no darlo por obvio. Análisis:

CLAUDE.md, "Patterns" §5, enuncia el patrón con su condicional intacto: *"When module A needs to ask
module B about something **but module B already imports from A**, define the port in **A's** domain
and the implementation in **B's** infrastructure."* El patrón existe **para romper un ciclo**. Su
precondición es que la arista de vuelta ya exista.

Tras P1/P2 esa precondición es **falsa** para el par que nos ocupa: `accounts` y `budgets` dejan de
importar `transactions` (ese es el entregable de P1). La arista `transactions → accounts/budgets` es
unidireccional y permanente (`PROBLEMS.md:25-26`). Por lo tanto:

- **Poner los puertos en `transactions/domain` recrearía el ciclo que P1/P2 acaba de eliminar.** El
  implementador es `accounts/infrastructure` (o `budgets/infrastructure`): tendría que importar
  `transactions/domain` para hacer `extends IScopedAccountRepository`. Eso es `accounts →
  transactions` — exactamente la arista que `PLAN-P1P2-accounts.md` §6.4 usa como criterio de
  "funcionó" (`grep -rn "transactions" src/modules/accounts --include=*.ts` → sin resultados).
  Aplicar el patrón acá sería *cargo cult*: copiar la forma sin su condicional.
- **Ponerlos en el dueño no agrega ninguna arista.** `ITransactionUnitOfWork.ts:3-4` ya importa
  `IAccountRepository` de `accounts/domain` y `IBudgetRepository` de `budgets/domain`. Los puertos
  nuevos viajan por la misma arista existente.

Además, la decisión ya está escrita en el repo: `src/shared/domain/uow-decision.md:11` —
*"Those repo interfaces are those of their owning module's domain (e.g. `IAccountRepository` still
belongs to `accounts/domain`); the UoW merely exposes them grouped according to what the use case
needs."* P5 no contradice ese ADR informal: es su aplicación literal, con la única diferencia de que
ahora el "grouping" es **por consumidor** y no uno solo para todos.

**Consecuencia sobre `docs/adr/0003-port-owned-by-consumer.md`** (y esto sí hay que decirlo en voz
alta): ese ADR está en `Status: Draft` (`:3`) con las secciones "Why this option" (`:27-31`) y
"Alternatives considered" (`:35-37`) sin completar, y su única evidencia de código es
`IExpenseChecker` implementado en transactions (`:13-17`). Tras `PLAN-P1P2-budgets.md` §4.1 el
`ScopedExpenseChecker` se muda a budgets, y el puerto pasa a estar **con su implementación en el
mismo módulo** — deja de ser un ejemplo del patrón. `IAccountUnitOfWork`, la otra evidencia citada
(`:17`), deja de implementarse en transactions por `PLAN-P1P2-accounts.md`.

> **Hallazgo:** tras P1/P2 + P5, el patrón "port owned by consumer" **no tiene ningún caso vivo en
> el código**. El ADR-0003 no debe parchearse en silencio: o se completa marcando explícitamente que
> describe un estado histórico superado, o se reemplaza por un ADR que enuncie la regla vigente
> ("los puertos viven con el dueño del agregado; el UoW multi-agregado compone las capacidades de
> los vecinos"). `PLAN-P1P2-budgets.md` §4.5 ya lo había señalado; P5 lo confirma y lo cierra.

Ubicación final propuesta:

```
accounts/domain/repository/scoped-account.repository.ts     → IScopedAccountRepository
budgets/domain/repository/scoped-budget.repository.ts       → IScopedBudgetRepository
budgets/domain/repository/budget-period-reader.port.ts      → IScopedBudgetPeriodReader
```

El sufijo `.port.ts` para el tercero sigue la convención de `expense-checker.port.ts` (capacidad de
un solo método nombrada por lo que hace, no por el agregado que persiste).

---

## 4. El rename y su impacto exacto

### 4.1 Los nombres

Convención verificada en el código, no en los docs: `findByIdWithLock`
(`scoped-transaction.repository.ts:10`, con su docblock `:7-8`: *"the name is explicit on purpose so
the lock is visible at every call site (mirrors auth's `findByTokenHashWithLock`)"*) y
`findByTokenHashWithLock` (`auth-unit-of-work.impl.ts:26`). **Sufijo `WithLock`.**

`docs/concurrency-model.md:367` propone `findByIdForUpdate()`. Es la propuesta **más vieja** que la
convención implementada; CLAUDE.md dice que cuando el código y el doc discrepan, gana el código.
→ `WithLock`, y se corrige el doc (§12).

| Antes | Después |
| --- | --- |
| `ScopedAccountRepository.findById` | `findByIdWithLock` |
| `ScopedBudgetRepository.findById` | `findByIdWithLock` |
| `ScopedBudgetRepository.findByUserIdAndCategoryIdAndPeriod` | `findByUserIdAndCategoryIdAndPeriodWithLock` |

El tercero queda en 42 caracteres. Se acepta: la casa ya tiene
`sumExpenseAmountByUserCategoryAndPeriod` (39, `unit-of-work.impl.ts:57`) y
`findByUserIdAndCategoryIdAndPeriod` (34). Un nombre corto inventado (`findForPeriodWithLock`) sería
más lindo pero convierte un rename **mecánico y grepeable** en un rebautizo semántico — mal negocio
en un cambio cuyo argumento es "no cambia comportamiento".

### 4.2 Impacto exacto — llamadores (7 líneas, 7 archivos)

| Archivo:línea | Cambio |
| --- | --- |
| `accounts/application/use-cases/archive-account.use-case.ts:25` | `accountRepo.findById` → `findByIdWithLock` |
| `accounts/application/use-cases/unarchive-account.use-case.ts:25` | ídem |
| `accounts/application/use-cases/rename-account.use-case.ts:26` | ídem |
| `accounts/application/use-cases/update-account-balance.use-case.ts:17` | ídem + tipo del parámetro en `:10` |
| `budgets/application/use-cases/delete-budget.use-case.ts:26` | `budgetRepo.findById` → `findByIdWithLock` |
| `budgets/application/use-cases/update-budget-limit.use-case.ts:34` | ídem |
| `transactions/application/use-cases/create-transaction.use-case.ts:106` | `findByUserIdAndCategoryIdAndPeriod` → `…WithLock` |

**Esto es exactamente el bloqueante que `PLAN-P1P2-accounts.md` §3 identificó y difirió.** Acá deja
de ser daño colateral y pasa a ser el contenido del commit.

Los tres use cases de accounts son los mismos que P1/P2 declaró intocables. **Eso no es una
contradicción: es la razón de que P5 vaya en su propio commit.** En P1/P2 tocarlos habría invalidado
el criterio "cambio de composición, no de contrato"; acá el cambio de contrato *es* el objetivo, y
el diff que lo demuestra es de una línea por archivo.

### 4.3 Impacto exacto — fakes (2 archivos)

Ambos adoptan el patrón de doble rol que **ya existe** en
`transactions/infrastructure/persistence/__fakes__/in-memory-transaction.repository.ts:8-23`
(docblock: *"Test double playing both roles: the query port (global repo) and the command port
(scoped repo)... In-memory has no real locks, so `findByIdWithLock` is the same lookup as
`findById`"*):

- `accounts/infrastructure/persistence/__fakes__/in-memory-account.repository.ts:4`
  → `extends IAccountRepository implements IScopedAccountRepository`; agregar
  `findByIdWithLock` delegando a `findById` (3 líneas).
- `budgets/infrastructure/persistence/__fakes__/in-memory-budget.repository.ts:7`
  → `extends IBudgetRepository implements IScopedBudgetRepository, IScopedBudgetPeriodReader`;
  agregar `findByIdWithLock` y `findByUserIdAndCategoryIdAndPeriodWithLock` delegando (6 líneas).

Mantienen `findById` y `findByUserIdAndCategoryIdAndPeriod` porque siguen jugando el rol **global**
(`create-transaction.use-case.spec.ts:45,47`: `new GetAccountByIdUseCase(accountRepo)`,
`new GetBudgetByUserCategoryPeriodUseCase(budgetRepo)`).

`transactions/infrastructure/persistence/__fakes__/in-memory-unit-of-work.ts`: cambian dos tipos
(`:18` `IAccountRepository` → `IScopedAccountRepository`; `:19` `IBudgetRepository` →
`IScopedBudgetPeriodReader`) y sus getters (`:49`, `:53`). El `:19` es opcional (`budgetRepo?`) y se
conserva opcional.

### 4.4 Impacto exacto — specs: **cero ediciones**

Verificado archivo por archivo. Es el resultado no obvio de este plan y conviene documentarlo:

| Spec | Por qué no cambia |
| --- | --- |
| `archive-account.use-case.spec.ts`, `unarchive-…`, `rename-…` | el mock del UoW es un objeto literal casteado (`:11-18`, `:31-33`) y devuelve el fake por `jest.fn().mockReturnValue(repo)` (`:17`). El tipo no se chequea y el método nuevo lo aporta el fake (§4.3) |
| `update-account-balance.use-case.spec.ts:16` | `new UpdateAccountBalanceUseCase(repo)` sigue compilando: tras §4.3 el fake satisface `IScopedAccountRepository` |
| `delete-budget.use-case.spec.ts:25-38`, `update-budget-limit.use-case.spec.ts:30-45` | mismo patrón (`Partial<IBudgetUnitOfWork>` + `jest.fn().mockReturnValue(budgetRepo)` en `:34` / `:41`) |
| `create-transaction.use-case.spec.ts:41`, `delete-transaction.use-case.spec.ts:25` | `new InMemoryUnitOfWork(txRepo, accountRepo, budgetRepo)` sigue compilando porque los fakes implementan los puertos nuevos |
| `create-transaction.use-case.spec.ts:112,145`, `delete-transaction.use-case.spec.ts:55,81` | llaman `accountRepo.findById('a1')` **directo sobre el fake** para asertar; el fake conserva `findById` (rol global) |
| `account.repo.implement.spec.ts:45-57`, `budget.repo.implement.spec.ts:42-95` | prueban los repos **globales**, que no cambian |

**Un test sí cambia**, y lo crea P1/P2: `accounts/infrastructure/persistence/scoped-account.repository.spec.ts`
(`PLAN-P1P2-accounts.md` §4 Paso 6) asserta que `findOne` se llama con
`lock: { mode: 'pessimistic_write' }`; hay que renombrar el método bajo prueba. Si el plan de
budgets agregó su equivalente, ídem.

---

## 5. Interacción con la factory (decisión B): qué devuelve

**La factory devuelve la capacidad acotada, nunca el repo completo.** Y para budgets hay **dos
factories sobre una sola clase privada**:

```ts
// budgets/infrastructure/persistence/scoped-budget.repository.ts
class ScopedBudgetRepository                       // privada al archivo (decisión B)
  extends IScopedBudgetRepository
  implements IScopedBudgetPeriodReader { … }

export function createScopedBudgetRepository(
  qr: QueryRunner, mapper: BudgetMapper,
): IScopedBudgetRepository { assertActive(qr); return new ScopedBudgetRepository(qr.manager, mapper); }

export function createScopedBudgetPeriodReader(
  qr: QueryRunner, mapper: BudgetMapper,
): IScopedBudgetPeriodReader { assertActive(qr); return new ScopedBudgetRepository(qr.manager, mapper); }
```

```ts
// accounts/infrastructure/persistence/scoped-account.repository.ts
export function createScopedAccountRepository(
  qr: QueryRunner, mapper: AccountMapper,
): IScopedAccountRepository { … }        // una sola: los dos consumidores necesitan lo mismo (§1.1)
```

Consecuencias, y por qué esto es el argumento fuerte a favor de B:

1. **Cero SQL duplicado, cero `FOR UPDATE` duplicado.** Una clase, dos vistas de tipo. El mecanismo
   de la Race 1 y de la Race 2 sigue teniendo **una** fuente de verdad — que es todo el punto de P2.
2. **El estrechamiento lo decide el dueño, no el consumidor.** Con la Opción A (clase exportada),
   `transactions` haría `new ScopedBudgetRepository(...)` y obtendría el tipo concreto; acotar
   requeriría que el *consumidor* anotara el tipo de retorno — y quien debe cumplir la restricción no
   puede ser quien la declara. La factory hace que el tipo acotado sea **lo único obtenible**.
3. **La guarda de runtime de B (`isTransactionActive`) y el estrechamiento de P5 son ortogonales y
   se acumulan**: B garantiza *"esto corre dentro de una transacción"*; P5 garantiza *"esto solo
   puede hacer lo que le corresponde"*. Ninguna de las dos implica la otra.

Getters resultantes:

```ts
// budgets/…/budget-unit-of-work.impl.ts
getScopedBudgetRepository(): IScopedBudgetRepository {
  return createScopedBudgetRepository(this.queryRunner!, this.mapper);
}

// transactions/…/unit-of-work.impl.ts
getScopedBudgetRepository(): IScopedBudgetPeriodReader {
  return createScopedBudgetPeriodReader(this.queryRunner!, this.budgetMapper);
}
getScopedAccountRepository(): IScopedAccountRepository {
  return createScopedAccountRepository(this.queryRunner!, this.accountMapper);
}
```

> Nota de nombres: el getter de transactions se sigue llamando `getScopedBudgetRepository` aunque
> devuelva un *reader*. Conviene renombrarlo a `getScopedBudgetPeriodReader()` para que el nombre no
> mienta — cuesta una línea en `ITransactionUnitOfWork.ts:21`, una en el impl, una en
> `create-transaction.use-case.ts:97` y una en el fake (`in-memory-unit-of-work.ts:53`). **Recomendado**,
> pero separable: si se prefiere un diff mínimo, dejar el nombre y anotarlo como deuda.

---

## 6. Cambios archivo por archivo

Orden de aplicación. (Rutas post-P1/P2 — ver §0.)

### 6.1 Puertos nuevos (3 archivos, solo se crean)

1. `accounts/domain/repository/scoped-account.repository.ts` → `IScopedAccountRepository` (§3.1).
2. `budgets/domain/repository/scoped-budget.repository.ts` → `IScopedBudgetRepository`.
3. `budgets/domain/repository/budget-period-reader.port.ts` → `IScopedBudgetPeriodReader`.

Cada uno con el docblock que aclara que **no es token de DI** y que solo se obtiene por la factory
del módulo (copiar el tono de `scoped-transaction.repository.ts:3-8`).

### 6.2 Implementaciones y factories

4. `accounts/infrastructure/persistence/scoped-account.repository.ts`:
   `extends IAccountRepository` → `extends IScopedAccountRepository`; `findById` → `findByIdWithLock`;
   **borrar** `findByUserId` y `delete` (hoy `unit-of-work.impl.ts:116-121` y `:129-131`, código
   muerto — §1.1); tipo de retorno de la factory → `IScopedAccountRepository`.
5. `budgets/infrastructure/persistence/scoped-budget.repository.ts`:
   `extends IScopedBudgetRepository implements IScopedBudgetPeriodReader`; los dos renames de §4.1;
   **borrar** `findByUserId` (hoy `unit-of-work.impl.ts:153-158`, código muerto); agregar la segunda
   factory (§5).

### 6.3 Puertos de UoW (tipos de retorno)

6. `accounts/domain/IAccountUnitOfWork.ts:5` → `getScopedAccountRepository(): IScopedAccountRepository`.
7. `budgets/domain/IBudgetUnitOfWork.ts:6` → `getScopedBudgetRepository(): IScopedBudgetRepository`.
8. `transactions/domain/ITransactionUnitOfWork.ts:3-4,20-21` → importar los puertos nuevos;
   `getScopedAccountRepository(): IScopedAccountRepository`;
   `getScopedBudgetRepository(): IScopedBudgetPeriodReader` (o renombrado, §5).
   Actualizar el docblock `:6-17`, que hoy dice *"return SCOPED repositories"*.

### 6.4 Impls de UoW

9. `accounts/…/account-unit-of-work.impl.ts` y `budgets/…/budget-unit-of-work.impl.ts`: tipos de
   retorno de los getters.
10. `transactions/…/unit-of-work.impl.ts:301-313`: tipos de retorno + la factory nueva de budgets.
    Los imports de `IAccountRepository` (`:7`) e `IBudgetRepository` (`:8`) quedan huérfanos →
    borrarlos (`@typescript-eslint/no-unused-vars` está en `error`, `eslint.config.mjs`).

### 6.5 Llamadores

11. Las 7 líneas de §4.2. En `update-account-balance.use-case.ts` cambian dos: el tipo del parámetro
    (`:10`) y la llamada (`:17`). **El cambio de `:10` convierte en tipo lo que el docblock `:6-8`
    ya afirma en prosa** (*"MUST run inside a UoW with a scoped, row-locked repository"*) — es el
    mejor resumen de qué compra P5.

### 6.6 Fakes

12. Los 3 archivos de §4.3.

### 6.7 Docs

13. §12.

---

## 7. Qué NO cambia

- **Ninguna consulta SQL.** P5 no toca un `where`, un `select`, un `lock:`, ni `monthPeriod`. El
  diff no debe contener ninguna línea con `pessimistic`, `FOR UPDATE`, `.from(`, `COALESCE` u
  `orderBy` salvo por el desplazamiento de líneas. Es un criterio verificable (§8.3).
- **Ningún `.spec.ts` existente** (§4.4), salvo el `scoped-*.repository.spec.ts` que crea P1/P2.
- **Ningún test de `test/integration/`**, con la excepción de comentarios obsoletos
  (`concurrency.integration.spec.ts:69` menciona `ScopedAccountRepository.findById`; `:110` menciona
  `ScopedBudgetRepository.findByUserIdAndCategoryIdAndPeriod`). Si se corrigen, el diff de ese
  archivo debe ser **solo de comentarios** — verificable con
  `git diff -- test/integration/concurrency/ | grep -E '^[+-]' | grep -v '^[+-]\s*//'` → vacío.
- **Los puertos globales** `IAccountRepository` e `IBudgetRepository`, sus impls
  (`account.repo.implement.ts`, `budget.repo.implement.ts`) y todos sus consumidores fuera del UoW.
- **`IExpenseChecker`** (`expense-checker.port.ts`) — §1.3.
- **El grafo de módulos y el cableado de DI.** P5 no agrega, quita ni mueve un solo provider. Es un
  cambio puramente de tipos + renames. Si el diff toca un `.module.ts`, algo se desvió.
- **`IUnitOfWork`** (`shared/domain/IUnitOfWork.ts`) y el ciclo de vida.

---

## 8. Verificación

### 8.1 A nivel de tipos — el oráculo principal

P5 es un cambio de tipos: su regresión natural también debe serlo. Un test que compila **solo si el
puerto sigue acotado**:

```ts
// src/modules/transactions/domain/__type-tests__/uow-narrowing.type-test.ts
import type { ITransactionUnitOfWork } from '../ITransactionUnitOfWork';
import type { IAccountUnitOfWork } from '../../../accounts/domain/IAccountUnitOfWork';

type Assert<T extends true> = T;
type Lacks<T, K extends string> = K extends keyof T ? false : true;

type TxBudget  = ReturnType<ITransactionUnitOfWork['getScopedBudgetRepository']>;
type TxAccount = ReturnType<ITransactionUnitOfWork['getScopedAccountRepository']>;
type OwnAccount = ReturnType<IAccountUnitOfWork['getScopedAccountRepository']>;

// transactions no puede escribir ni borrar un budget dentro de su transacción (P5)
type _budgetNoSave   = Assert<Lacks<TxBudget, 'save'>>;
type _budgetNoDelete = Assert<Lacks<TxBudget, 'delete'>>;
// transactions guarda la cuenta (invariante de balance) pero nunca la borra
type _accountNoDelete = Assert<Lacks<TxAccount, 'delete'>>;
// el UoW propio de accounts tampoco: DeleteAccount corre fuera del UoW
type _ownAccountNoDelete = Assert<Lacks<OwnAccount, 'delete'>>;

export {};
```

Propiedades, verificadas contra la config real del repo:

- **Emite cero JavaScript.** Solo alias de tipo + `export {}` (necesario por
  `"isolatedModules": true`, `tsconfig.json`). Por eso puede vivir bajo `src/` sin ensuciar `dist/`.
- **Lo chequea el build existente.** `tsconfig.build.json` excluye `node_modules`, `test`, `dist` y
  `**/*spec.ts`; un archivo `*.type-test.ts` bajo `src/` **queda incluido** → `npm run build` es el
  gate, sin config nueva.
- **Jest lo ignora.** `testRegex: ".*\\.spec\\.ts$"` (`package.json:122`) no matchea `.type-test.ts`,
  así que no rompe la suite con "must contain at least one test".
- **ESLint no se queja** de los alias sin usar: `varsIgnorePattern: '^_'` (`eslint.config.mjs`).

Si alguien vuelve a ensanchar un puerto, `Lacks<…>` pasa a `false`, viola `T extends true` y
**`npm run build` falla**. Eso es la garantía impuesta por el compilador que P5 promete.

> **Variante más legible, con un costo:** los mismos chequeos con `@ts-expect-error` sobre llamadas
> reales (`budgetRepo.delete('b1')`). Falla con TS2578 *"Unused '@ts-expect-error' directive"* si el
> método reaparece. Es más directo de leer, pero **emite JS** (sentencias sobre un `declare const`)
> hacia `dist/`. Si se elige, excluir `**/*.type-test.ts` en `tsconfig.build.json` y agregar
> `"typecheck": "tsc --noEmit -p tsconfig.typecheck.json"` con un config que sí lo incluya.

**Advertencia verificada, importante:** `npx tsc --noEmit -p tsconfig.json` **hoy falla** con 6
errores preexistentes, todos en specs (`register.use-case.spec.ts:69`,
`category.entity.spec.ts:54,396`, `transaction.repo.implement.spec.ts:25`, `email.vo.spec.ts:243,244`).
No los ve nadie porque `ts-jest` transpila sin type-check (`"isolatedModules": true`). Por eso el
gate **no puede ser** `tsconfig.json`: usar `tsconfig.build.json`, que sí está limpio hoy
(verificado: `npx tsc --noEmit -p tsconfig.build.json` → sin salida). Arreglar esos 6 es un tema
aparte y **no** debe entrar en este commit.

### 8.2 A nivel de comportamiento

```
npm run build                 # incluye el type-test de §8.1 — el gate de P5
npm run lint
npm test                      # unit; debe pasar SIN editar ningún .spec.ts preexistente
npm run test:integration
```

Oráculos de comportamiento (deben pasar **sin modificarse**), por si un rename se llevó puesto un
lock:

| Archivo:línea | Qué cubre |
| --- | --- |
| `test/integration/concurrency/concurrency.integration.spec.ts:179` | período vacío — el detector más sensible del `FOR UPDATE` sobre la fila de budget (`PLAN-P1P2-budgets.md` §7.1) |
| `…:74`, `…:292` | detectores duros del `FOR UPDATE` sobre la fila de cuenta |
| `…:224`, `…:447` | B4 y Race 1 |
| `…:357`, `…:399` | Race 2 y Race 3 |
| `test/integration/reports/summary-enforcement-equivalence.integration.spec.ts` | equivalencia de la definición de gasto entre reports y los tres enforcement |

### 8.3 Verificación estructural del diff

```bash
# 1) P5 no toca SQL ni locks: debe salir VACÍO
git diff <base>..HEAD -- 'src/**/*.ts' | grep -E '^[+-]' | grep -Ei 'pessimistic|for update|COALESCE|\.from\(|monthPeriod'

# 2) P5 no toca el cableado: debe salir VACÍO
git diff --name-only <base>..HEAD -- 'src/**/*.module.ts'

# 3) el puerto acotado no reintrodujo herencia del completo
grep -rn "IScopedAccountRepository\|IScopedBudgetRepository\|IScopedBudgetPeriodReader" src --include=*.ts | grep "extends I.*Repository$"
#    ninguna de las tres debe extender IAccountRepository / IBudgetRepository
```

---

## 9. Riesgos y modos de falla

### 9.1 El rename se lleva el lock (riesgo real, silencioso)

El compilador garantiza que **ningún llamador queda huérfano** (si falta un rename, `tsc` falla). Lo
que **no** garantiza es que el cuerpo del método renombrado conserve
`lock: { mode: 'pessimistic_write' }`. Un `findByIdWithLock` sin la opción `lock` compila, pasa todo
unit test (mockean el puerto) y solo se manifiesta como corrupción bajo concurrencia.

*Detección:* (a) el test unitario del repo scoped que crea P1/P2 —
`scoped-account.repository.spec.ts`, `PLAN-P1P2-accounts.md` §4 Paso 6 — asserta la opción `lock`
literalmente; **actualizarle el nombre del método, no borrar la aserción**; (b) el grep 1 de §8.3
debe salir vacío, porque P5 no tiene por qué tocar esas líneas; (c) el test de la línea 179.

### 9.2 El fake miente

`in-memory-*.repository.ts` implementan `findByIdWithLock` como un lookup sin lock — correcto y
documentado (`in-memory-transaction.repository.ts:8-10`), pero significa que **ningún test unitario
puede detectar la ausencia de lock**. No es un riesgo nuevo de P5; sí conviene que el docblock de
los dos fakes nuevos repita la advertencia, para que nadie interprete un test verde como evidencia
de serialización.

### 9.3 Un `save` sobrante que P5 **no** quita

P5 le saca a `transactions` el `delete` de cuenta y el `save`/`delete` de budget. **No** le saca el
`save` de cuenta: es legítimo (§2). O sea, `CreateTransactionUseCase` sigue pudiendo, por tipo,
escribir cualquier balance. Eso no es un agujero de P5: es la frontera del agregado real
(`PROBLEMS.md:16-26`). Decirlo evita vender P5 como más de lo que es.

### 9.4 Falso sentido de cierre sobre ADR-0003

Si el ADR se parchea sin marcar el cambio de estado (§3.2), queda un documento que describe un
patrón sin ningún caso vivo, presentado como vigente. Es deriva documental de la peor clase: la que
enseña mal a quien llega.

### 9.5 Riesgo bajo

- **Asignabilidad de los fakes.** `IScopedAccountRepository` no declara miembros privados, así que
  una clase que solo tenga los métodos es estructuralmente asignable. Aun así se recomienda
  `implements` explícito (§4.3), copiando `in-memory-transaction.repository.ts:11-14`: elimina toda
  duda y hace que un cambio de puerto rompa el fake en compilación.
- **Runtime.** Cero. No hay cambio de consultas, de conexiones, de scope de DI ni de esquema.

---

## 10. Dependencia de orden

### 10.1 ¿P5 exige P1/P2? — Técnicamente **no**; en la práctica **sí**

Verificado que **no hay bloqueo técnico**: los puertos nuevos viven en `accounts/domain` y
`budgets/domain`, que no importan nada de `transactions`; la clase privada actual
(`unit-of-work.impl.ts:97-132`, `:134-186`) podría implementarlos hoy mismo sin crear ninguna arista
nueva — `ITransactionUnitOfWork.ts:3-4` ya importa de ambos dominios. P5 antes de P1/P2 **compila**.

Tres razones para no hacerlo:

1. **Doble edición de las mismas líneas.** P1/P2 mueve esas clases de archivo; P5 les cambia el tipo
   y renombra métodos. Hacer P5 primero obliga a rehacer el trabajo y destruye la propiedad que hace
   auditable a P1/P2: que su diff sea un **movimiento puro** (`PLAN-P1P2-accounts.md` §7.3,
   `PLAN-P1P2-budgets.md` §7.1, cuyo criterio es "mismas líneas, otro archivo").
2. **El estrechamiento por consumidor sale gratis gracias a la factory** (§5), y la factory la
   introduce P1/P2 (decisión B). Sin ella, dar dos vistas distintas de una misma clase exige que el
   consumidor anote el tipo — es decir, que la restricción la declare quien debe cumplirla.
3. **P1/P2 declaró intocables los tres use cases de accounts.** P5 los toca (§4.2). Invertir el
   orden mezcla los dos criterios de corrección y deja ambos sin poder verificarse.

### 10.2 Relación con P6

Si P6 aterriza (`PLAN-P1P2-budgets.md` §5.3), `IScopedTransactionRepository` pierde
`sumExpenseAmountByUserCategoryAndPeriod` (`scoped-transaction.repository.ts:11-16`) y
`CreateTransaction` pasa a consumir `IExpenseChecker`. Eso **también** es un estrechamiento. Hacer
P5 antes que P6 significa estrechar un puerto que P6 va a volver a tocar.
**Recomendación: P6 antes que P5.** Coincide con `PROBLEMS.md:404`.

### 10.3 Relación con P3/P4 — **desvío propuesto respecto de `PROBLEMS.md:404`**

`PROBLEMS.md:404` sugiere `P7 → P1+P2 → P6 → P3+P4 → P5`, con P5 al final por ser "endurecimiento"
independiente. No hay dependencia técnica en ninguna dirección. Pero P3/P4 reescribe la **forma** del
UoW (de `begin/commit/release` a un runner por callback, `PROBLEMS.md:203-206`): el contexto que ese
callback recibe va a cargar los repos scoped. Es preferible que nazca ya con los tipos definitivos, en
lugar de nacer con los anchos y estrecharse después.

**Orden recomendado: P7 → P1+P2 → P6 → P5 → P3+P4.** El desvío es deliberado y su único argumento es
"no escribir dos veces la misma firma"; si el equipo prefiere respetar `PROBLEMS.md:404`, P5 igual
funciona al final, con más churn.

---

## 11. Commits y punto de rollback

Dos commits. Ambos compilan y pasan la suite completa.

| # | Contenido | Estado tras el commit |
| --- | --- | --- |
| **1** | §6.1 (los 3 puertos nuevos) + §8.1 (el type-test). **Nada cableado, nada renombrado.** El type-test **falla** todavía → agregarlo recién en el commit 2, o agregarlo acá ya en verde solo si los puertos nuevos aún no se usan (los `Lacks<>` miran los tipos de retorno del UoW, que aún no cambiaron ⇒ **falla**). → **Poner el type-test en el commit 2.** | Solo se agregan 3 archivos de tipos, sin consumidores. Riesgo cero. |
| **2** | §6.2-§6.6: impls, factories, tipos de retorno de los 3 puertos de UoW, las 7 líneas de llamadores, los 3 fakes, y el type-test de §8.1. | **El commit de P5.** Punto de verificación completo (§8). |
| **3** | §12 (documentación, incluido el cierre de ADR-0003). | Docs alineadas. |

**Punto de rollback: `git revert` del commit 2.** Autocontenido; el 1 queda como tipos muertos
inofensivos. Sin migraciones, sin estado persistido, sin cambio de DI: el rollback es puro código.

Si se quisiera partir más fino, el corte natural es **accounts primero, budgets después** (son
independientes: distintos puertos, distintos llamadores, cero archivos compartidos salvo
`unit-of-work.impl.ts` y `in-memory-unit-of-work.ts`). Solo conviene si P5 se ejecuta mientras P1/P2
de budgets todavía está en vuelo.

---

## 12. Deuda documental que P5 debe saldar en el mismo PR

Regla de CLAUDE.md: si el código y el doc discrepan, gana el código, pero el doc se corrige en el
mismo cambio.

| Archivo:línea | Qué corregir |
| --- | --- |
| `docs/concurrency-model.md:365-369` (§13.1) | P5 **implementa** este "robust fix (future)" pero con dos correcciones: el nombre es `findByIdWithLock` (no `findByIdForUpdate`) y la forma es un puerto **hermano**, no `IScopedAccountRepository extends IAccountRepository` — heredar arrastraría `delete()` y anularía P5 |
| `docs/concurrency-model.md:77` y tabla de locks | nombres de método renombrados |
| `src/modules/transactions/notes.md:203-204` | *"It doesn't require creating parallel scoped interfaces (`IScopedAccountRepository extends IAccountRepository`)... Minimal change, maximum coverage"* — es la justificación que P5 revierte. Reescribir explicando el cambio de criterio, no borrar |
| `CLAUDE.md`, mapa de "Locking & serialization" | `ScopedAccountRepository.findById` → `findByIdWithLock`; `ScopedBudgetRepository.findById` / `findByUserIdAndCategoryIdAndPeriod` → `…WithLock` |
| `CLAUDE.md`, "Scoped resources" | los getters devuelven capacidades acotadas, no los puertos completos |
| `CLAUDE.md`, "Known gaps" | el bullet *"`ITransactionRepository` is split into a query port and a command port… enforced by types"* ahora aplica a los tres agregados: actualizar |
| `src/shared/domain/uow-decision.md:9,11` | el "Level 2" pasa a describir el grouping **por consumidor**; `:11` se conserva (P5 lo confirma) |
| `docs/adr/0003-port-owned-by-consumer.md` | **no parchear en silencio** (§3.2, §9.4): completar marcando el estado como histórico/superado, o reemplazar por un ADR que enuncie la regla vigente. Sus dos evidencias de código (`:13-17`) dejan de existir tras P1/P2 |
| `src/modules/accounts/notes.md:69,156` | `IAccountRepository` deja de ser lo que consume transactions |
| `src/modules/budgets/notes.md` | equivalente del lado budgets |
| `src/PROBLEMS.md:250-269` | marcar P5 como resuelto, con el criterio de §2 como la regla que quedó |
| `test/integration/concurrency/concurrency.integration.spec.ts:69,110` | comentarios con nombres viejos. Diff **solo de comentarios** (§7) |
