# Dependencias circulares: estado, causa y propuestas de refactor

> Análisis del grafo real de dependencias entre módulos, la razón de los ciclos existentes,
> lo que cuestan hoy, y las salidas posibles (ideas generales, no planes de ejecución).

---

## 1. El mapa real

```
users ──> (nada)
auth  ──> users
categories ──> (nada)          ← hoja, sin ciclos
reports ──> (nada)             ← solo toca la vista v_period_expenses

        ┌──────────────────────────────┐
        │                              ▼
   accounts  ◄────────────────────  transactions
        ▲                              │  ▲
        │                              ▼  │
        └────────────  budgets ◄─────────┘
                          ▲
                          └──────────────┘
```

Dos ciclos, ambos con `forwardRef()` en los dos extremos:

- `transactions ↔ accounts` (`transactions.module.ts:32` ↔ `accounts.module.ts:29`)
- `transactions ↔ budgets` (`transactions.module.ts:34` ↔ `budgets.module.ts:23`)

`categories` está fuera: la importan `transactions` y `budgets`, pero no importa a nadie.
`auth` tiene su propio UoW y por eso es acíclico — es la prueba de que el patrón *puede* no ciclar.

---

## 2. Qué carga cada arista

### `transactions → accounts` / `transactions → budgets` (la dirección "natural")

`CreateTransactionUseCase` orquesta tres agregados, y lo hace pidiéndole cosas a los vecinos:

| Qué importa                              | De dónde                    | Para qué                                          |
| ---------------------------------------- | --------------------------- | ------------------------------------------------- |
| `GetAccountByIdUseCase`                  | accounts/application        | fail-fast 404/403 antes de abrir la tx            |
| `GetCategoryByIdUseCase`                 | categories/application      | validar nature compatible                         |
| `GetBudgetByUserCategoryPeriodUseCase`   | budgets/application         | pre-check de existencia de budget                 |
| `UpdateAccountBalanceUseCase`            | accounts/application        | se instancia a mano con el repo *scoped*          |
| `AccountMapper`, `BudgetMapper`          | accounts/infra, budgets/infra | inyectados en el ctor del UoW                   |
| `AccountOrmEntity`, `BudgetOrmEntity`    | accounts/infra, budgets/infra | los repos scoped hacen `manager.findOne(...)`   |
| `IAccountRepository`, `IBudgetRepository`| accounts/domain, budgets/domain | los repos scoped **extienden** esos puertos   |

Esta dirección es legítima: `transactions` es el agregado coordinador. Sola, no ciclaría.

### `accounts → transactions` / `budgets → transactions` (la arista de vuelta)

Esta es la que cierra el ciclo, y **no lleva ninguna semántica de dominio**. Lo que realmente
importan `accounts.module.ts` y `budgets.module.ts` de `transactions` es nada más que el módulo
entero, para poder resolver un token de DI.

- `ArchiveAccountUseCase`, `UnarchiveAccountUseCase`, `RenameAccountUseCase` inyectan
  `IAccountUnitOfWork` — puerto que vive en `accounts/domain/IAccountUnitOfWork.ts`, pero cuyo
  **provider** está declarado en `transactions.module.ts:71-74` y exportado en la línea 76.
- `DeleteBudgetUseCase`, `UpdateBudgetLimitUseCase` inyectan `IBudgetUnitOfWork` — mismo caso,
  `transactions.module.ts:67-70`.

`accounts` no necesita saber nada de transacciones financieras. Necesita **una conexión con
transacción abierta y `FOR UPDATE`**. Eso es infraestructura pura. El ciclo no viene de una
relación entre los dominios: viene de **dónde vive el provider**.

### Nivel de archivo TypeScript

El único ciclo a nivel de archivo `.ts` es entre los tres `.module.ts`. Ningún use case, entidad
o repositorio de `accounts` o `budgets` importa nada de `transactions`. Es decir: **el ciclo está
confinado a la capa de composición**, no contamina el código de negocio.

---

## 3. La causa raíz, en una frase

> `CreateTransaction` necesita atomicidad sobre tres tablas; la implementación de esa atomicidad
> (`TypeOrmUnitOfWorkImpl`) se puso dentro de `transactions` porque ahí nace la necesidad; y como
> `accounts` y `budgets` también necesitan transaccionalidad *para sus propios flujos*, terminan
> importando al módulo que casualmente hospeda la máquina.

Hay tres estratos de acoplamiento superpuestos, y conviene separarlos porque tienen soluciones distintas:

| Estrato               | Dirección                                                    | ¿Es ciclo?                        | ¿Es evitable?                        |
| --------------------- | ------------------------------------------------------------ | --------------------------------- | ------------------------------------ |
| **Puertos / dominio** | `transactions` implementa puertos de `accounts` y `budgets`  | No — está invertido correctamente | Ya está bien                         |
| **Composición / DI**  | ambos módulos importan a `transactions` por el token         | **Sí**                            | Sí, es reubicación                   |
| **Infra: "UoW dios"** | `unit-of-work.impl.ts` sabe persistir 3 agregados            | No (unidireccional)               | Sí, redistribuyendo los repos scoped |

El primer estrato está bien resuelto: los puertos los define el consumidor (`IAccountUnitOfWork` en
accounts, `IBudgetUnitOfWork` e `IExpenseChecker` en budgets), y la implementación la aporta
transactions. Eso es inversión de dependencias de manual. **El problema es que la inversión se hizo
en el dominio pero no en la composición.**

---

## 4. Lo que cuesta hoy (consecuencias reales, no teóricas)

### a) Contagio de `Scope.REQUEST` — el costo invisible y el más grande

`TypeOrmUnitOfWorkImpl` es `@Injectable({ scope: Scope.REQUEST })` (`unit-of-work.impl.ts:254`).
Los tres alias por `useExisting` heredan el scope. En Nest el scope **burbujea hacia arriba**:
cualquier clase que dependa de un provider request-scoped se vuelve request-scoped, hasta el controller.

```
TypeOrmUnitOfWorkImpl (REQUEST)
  → IAccountUnitOfWork → Archive/Unarchive/Rename (REQUEST)
      → AccountsController (REQUEST)
  → IBudgetUnitOfWork → DeleteBudget/UpdateBudgetLimit (REQUEST)
      → BudgetsController (REQUEST)
  → ITransactionUnitOfWork → Create/DeleteTransaction (REQUEST)
      → TransactionsController (REQUEST)
```

Tres de los seis controllers de la API se instancian por request. Un `GET /accounts`, que es una
lectura pura sin transacción ni lock, paga la resolución del árbol de DI en cada llamada — solo
porque el mismo controller expone `PATCH /accounts/:id/archive`. No hay *durable providers*
configurados (no aparece `ContextIdFactory` ni `durable` en todo `src/`). La granularidad del scope
es el controller, y la necesidad real son 8 use cases de escritura.

### b) El `forwardRef()` en sí

Funciona, pero difiere la resolución del módulo. Cuando algo se rompe dentro del ciclo, el error de
Nest no apunta al problema real: sale el clásico `Nest can't resolve dependencies of X (?)` con
"index [0] is available in the Y context", que obliga a reconstruir el grafo a mano. Es un costo de
diagnóstico, no de runtime.

### c) El ciclo entre los tres `.module.ts` a nivel CommonJS

Node lo resuelve dando un objeto parcialmente inicializado a uno de los tres — para eso existe
`forwardRef`. Hoy es inocuo porque los tres archivos solo exportan clases decoradas. Pero es una
trampa latente: si alguien agrega una `const` de nivel superior en `accounts.module.ts` calculada a
partir de un export de `transactions.module.ts`, va a valer `undefined` silenciosamente según el
orden de evaluación.

### d) El puerto transaccional expone demasiado

`ITransactionUnitOfWork` (`transactions/domain/ITransactionUnitOfWork.ts:20-21`) devuelve
`IAccountRepository` e `IBudgetRepository` **completos** — con `save()` y `delete()`. O sea: por
tipo, `CreateTransactionUseCase` puede borrar un budget o una cuenta dentro de su transacción. Nada
lo impide. Compárese con `IScopedTransactionRepository`, donde sí se hizo el trabajo de separar
puerto de query y puerto de comando. La misma disciplina no se aplicó a los agregados vecinos.

### e) Ownership difusa de la política de locks

`ScopedAccountRepository.findById` toma `FOR UPDATE` sobre la fila de cuenta. Esa es una decisión
sobre **el invariante de accounts**, escrita en un archivo de `transactions`. Si mañana alguien de
accounts quiere entender por qué su fila se bloquea, tiene que ir a leer el módulo de transacciones.
Lo mismo con la fila de budget.

### f) Lecturas duplicadas

`CreateTransaction` lee la cuenta (vía `GetAccountByIdUseCase`, conexión global, sin lock) y luego la
relee con lock dentro del UoW. Ídem con el budget (líneas 61 y 106). Es un fail-fast deliberado y
barato, pero la primera lectura es justo la que fuerza el import a nivel *application* de los vecinos.

---

## 5. Lo que NO hay que tocar

Para acotar el blast radius:

- **La dirección del dominio ya es correcta.** Los puertos los posee el consumidor. Eso no se toca.
- **El modelo de locks es correcto y no necesita el ciclo.** Punto importante y fácil de
  malinterpretar: la serialización entre dos requests concurrentes la da **Postgres sobre la fila**,
  no el hecho de que los tres tokens resuelvan a la misma instancia. El `useExisting` solo garantiza
  que *dentro de un mismo request* los repos scoped compartan `QueryRunner`. Dos requests distintos
  con dos UoW distintos que bloquean la misma fila siguen serializándose igual de bien. Esto
  significa que **partir el UoW no debilita ninguna garantía de concurrencia**, siempre que un flujo
  dado use un único UoW de punta a punta — y hoy es así.
- **`ScopedExpenseChecker` ya no depende de `transactions`.** Su constructor recibe solo
  `EntityManager`, y sus dos métodos consultan `v_period_expenses` con SQL crudo
  (`unit-of-work.impl.ts:188-243`). No importa `TransactionOrmEntity`, ni `TransactionMapper`, ni
  nada de transactions. Desde que la vista existe, la razón original por la que ese checker vive en
  `transactions` **ya se evaporó** — solo que nadie movió el archivo. `reports` ya demuestra el
  patrón: lee la misma vista con cero acoplamiento de compilación a transactions.

---

## 6. Propuestas

De menor a mayor cirugía. No son excluyentes; las tres primeras componen bien.

### Propuesta 0 — Mover `ScopedExpenseChecker` a `budgets/infrastructure`

**Idea:** el checker lee una vista SQL con `EntityManager` crudo. Que viva en budgets, junto al
puerto que implementa, y que lo construya un UoW de budgets.

**Por qué resuelve:** elimina **por completo** una de las dos aristas de vuelta. `budgets` deja de
necesitar `IExpenseChecker` desde afuera. Es el movimiento con mejor relación beneficio/riesgo de
toda la lista, porque es puro traslado de archivo: no cambia una sola query, ni un lock, ni un plan
de ejecución. La vista es exactamente el mecanismo que permite leer datos de transacciones sin
depender del código de transacciones — la misma jugada que ya validó `reports`.

**Costo:** casi nulo. Deja `budgets` a un solo paso de ser acíclico.

---

### Propuesta 1 — Sacar el UoW a un módulo de persistencia neutral

**Idea:** `TypeOrmUnitOfWorkImpl` y los repos scoped dejan de vivir en `transactions` y pasan a un
módulo compartido (`shared/persistence` o similar) que importan los tres. Los puertos
(`IAccountUnitOfWork`, `IBudgetUnitOfWork`, `ITransactionUnitOfWork`) **se quedan donde están**, en
el dominio de cada consumidor.

**Por qué resuelve:** el ciclo existe porque el recurso compartido está alojado dentro de uno de los
pares. Si el recurso vive en un vértice neutral, todas las flechas apuntan hacia abajo:
`transactions → shared`, `accounts → shared`, `budgets → shared`. El grafo se vuelve un DAG y los
tres `forwardRef()` desaparecen. La dependencia `transactions → accounts/budgets` a nivel
application sobrevive, pero es unidireccional y por lo tanto inocua.

**Costo:** bajo. Son movimientos de archivo y rewiring de módulos; ni el modelo de locks ni las
queries cambian.

**Limitación honesta:** no arregla el "UoW dios" ni el request scope. Solo mueve la clase a un lugar
donde que sepa de tres agregados sea *honesto* en vez de sorprendente.

---

### Propuesta 2 — Un UoW por módulo; cada módulo publica su propio repo scoped

**Idea:** replicar lo que `auth` ya hace. `accounts` tiene su `AccountUnitOfWorkImpl` (solo el repo
de cuentas). `budgets` tiene el suyo (repo de budgets + expense checker sobre la vista, vía
Propuesta 0). `transactions` conserva el multi-agregado, pero **componiendo** las clases scoped que
publican los vecinos: `new ScopedAccountRepository(this.queryRunner.manager, mapper)`, con esa clase
exportada desde `accounts/infrastructure`.

**Por qué resuelve:** ataca las dos cosas a la vez. El ciclo se rompe porque `accounts` y `budgets`
pasan a ser autosuficientes — caso por caso: `Archive`/`Unarchive`/`Rename` usan **únicamente**
`getScopedAccountRepository()`, y `DeleteBudget`/`UpdateBudgetLimit` usan **únicamente**
`getScopedBudgetRepository()` + `getScopedExpenseChecker()`. Ninguno de los cinco toca nada de
transacciones. Y el "UoW dios" se disuelve porque la política de locks de cada fila vuelve a su
dueño: quien define el invariante de la cuenta define el `FOR UPDATE` sobre la cuenta.

Queda una sola flecha `transactions → accounts/budgets`, unidireccional, y ahora explícita:
transactions *compone* piezas que los vecinos publican, en lugar de reimplementar su persistencia.

**Costo:** medio. Dos impls de UoW más, y hay que decidir si `ScopedAccountRepository` se exporta
como clase reutilizable (limpio) o se duplica (feo). Recomendable lo primero.

**Bonus:** habilita restringir el puerto — transactions podría recibir una interfaz de comando
acotada de accounts/budgets, en vez del `IAccountRepository` completo con `delete()`. Cierra el
punto (d).

---

### Propuesta 3 — El UoW deja de ser un objeto con estado y pasa a ser un callback

**Idea:** en lugar de inyectar un objeto mutable con `begin()`/`commit()`/`rollback()`/`release()`,
inyectar un runner sin estado: `run(work => ...)` que abre la transacción, entrega un contexto con
los repos scoped, y hace commit o rollback según si el callback lanzó.

**Por qué resuelve:** el `Scope.REQUEST` existe **solo** porque `TypeOrmUnitOfWorkImpl` guarda
`queryRunner` como campo mutable (`unit-of-work.impl.ts:259`) — necesita una instancia por request
para no pisarse. Si el `QueryRunner` vive en el stack de la llamada en vez de en un campo, el
provider es stateless y puede ser singleton. Adiós contagio de scope: los tres controllers vuelven a
instanciarse una vez. De paso desaparece el `try/catch/finally` replicado en los 8 use cases, con su
riesgo latente de olvidar `release()`.

**Costo:** medio. Cambia la forma de los 8 use cases y de sus tests. Es ortogonal al ciclo — se
puede hacer antes o después.

---

### Propuesta 4 — Propagación transaccional implícita vía `AsyncLocalStorage`

**Idea:** el `EntityManager` activo se guarda en contexto asíncrono; un decorador `@Transactional()`
abre la transacción y **los repositorios normales** detectan el manager ambiente. Desaparece la
dualidad "repo global vs repo scoped".

**Por qué resuelve:** mata todo de raíz. Cada módulo tiene **un solo** repositorio,
transaction-aware. No hay UoW dios, no hay repos scoped duplicados, no hay request scope, y la regla
"no leas con el repo global dentro de un UoW" deja de ser una convención que hay que recordar para
volverse imposible por construcción.

**Por qué no se recomienda acá:** vuelve implícito el mecanismo más delicado del sistema. Los
`FOR UPDATE` siguen siendo explícitos, pero *dónde empieza y termina la transacción* pasa a ser
magia de decorador. En un sistema cuyo mayor activo documental es precisamente el mapa explícito de
locks y serialización, cambiar explícito por implícito es un retroceso de legibilidad. Vale la pena
conocerla; no es la elección para este proyecto.

---

### Propuesta 5 — Eliminar la transacción multi-agregado

**Idea:** que el balance de la cuenta deje de escribirse dentro de la transacción y pase a ser
derivado (una vista/columna mantenida por trigger, o un handler de evento con outbox).

**Por qué resolvería:** el ciclo y el UoW dios existen exclusivamente para hacer atómicas tres
escrituras. Si el balance es *derivado*, `transactions` deja de escribir en `accounts` — solo lo lee
para validar existencia y estado archivado. La necesidad estructural desaparece.

**Por qué no alcanza:** el invariante de budget (`Σ gastos del período ≤ límite`) es un invariante
duro con lectura-antes-de-escribir. Ese sí necesita consistencia fuerte y no se puede volver
eventual sin cambiar la semántica visible al usuario (se aceptaría un gasto que excede el límite y
se compensaría después). O sea que resolvería la mitad del problema, con el mayor costo de la lista
y un cambio de contrato de negocio. Mencionable como ejercicio de diseño, desproporcionado como
acción.

---

## 7. Orden recomendado

**0 → 2 → 3.**

La Propuesta 0 es prácticamente gratis y elimina una arista sola: el checker ya no tiene ninguna
razón técnica para vivir donde vive. Con eso hecho, la Propuesta 2 es un paso corto (accounts y
budgets ya quedaron demostrablemente autosuficientes) y arregla el ciclo *y* la ownership de los
locks de una sola vez — la Propuesta 1 es la variante barata si se prefiere no tocar la estructura
interna del UoW, pero deja el UoW dios intacto.

La Propuesta 3 va después y como cambio independiente: es la única que ataca el request scope, que
probablemente sea hoy el costo más caro y menos visible de todo el arreglo.
