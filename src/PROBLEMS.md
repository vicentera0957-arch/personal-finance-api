# Inventario de problemas estructurales

> Descomposición del acoplamiento entre `transactions`, `accounts`, `budgets` y `auth` en problemas
> **independientes y accionables**. Cada uno tiene enunciado, evidencia en código, costo real,
> grado de independencia, propuesta y criterio de verificación.
>
> Esto **no** es un plan de ejecución. Es el mapa de qué problema específico se está resolviendo
> con cada movimiento, para no confundir causas con síntomas.
>
> **P1, P2, P3, P4 y P7 están cerrados** y se eliminaron de este inventario. P1 y P2 rompían los dos
> ciclos de módulos dando a `accounts` y a `budgets` su propio UoW; el resultado vive en el código y
> en la sección de concurrencia de `CLAUDE.md`. P7 (la invalidación de caché disparando un
> `rollback()` sobre una transacción ya commiteada) se cerró con `PLAN-P7-cache-rollback.md`: la
> invalidación ahora corre en su propio `try/catch` post-commit (ver `CLAUDE.md`, "Anti-patterns").
> P3 y P4 se cerraron juntos, con la misma cirugía prevista más abajo (ver `Mapa de dependencias`),
> vía `PLAN-P3P4-transactional-runner.md`: el UoW pasó de máquina de estado (`begin`/`commit`/
> `rollback`/`release`/`isConnected`, campo `QueryRunner` mutable, `Scope.REQUEST`) a runner sin
> estado (`run<T>(work)`, `TypeOrmTransactionRunner`, `QueryRunner` en el stack de la llamada). Los
> 4 impls son singletons; ya no hay ningún provider `Scope.REQUEST` en el grafo, y los 7 controllers
> de dominio se resuelven una sola vez por proceso (`test/integration/di-scope.integration.spec.ts`
> lo prueba, no sólo lo asume). El resultado vive en el código y en la sección de concurrencia de
> `CLAUDE.md`. **P5 también se cerró**, sobre el estado post-runner, vía `PLAN-P5-narrow-ports.md`:
> `ctx.accounts` / `ctx.budgets` en `TransactionTxContext` dejaron de ser los puertos completos
> (`IAccountRepository`, `IBudgetRepository`) y pasaron a ser `IScopedAccountRepository` (sin
> `findByUserId` ni `delete`) y, por separado, `ctx.budgetPeriodReader: IScopedBudgetPeriodReader`
> (sólo lectura — `transactions` nunca escribe un budget). Un type-test
> (`transactions/domain/__type-tests__/uow-narrowing.type-test.ts`, gateado por `npm run build`)
> falla en compilación si algún puerto escopado vuelve a ganar `save`/`delete` sobre un agregado que
> no le pertenece. El problema que queda (P6) es una duplicación de query, no de composición entre
> módulos ni de ciclo de vida transaccional.

---

## Marco previo

Tres hechos verificados que condicionan todo lo demás. Sin ellos, el inventario se lee mal.

### 1. Los tres agregados están soldados por el invariante, no por el código

`Σ gastos del período ≤ límite` y `balance ≥ 0` son ambos **guards de lectura-antes-de-escribir**, y
ambos se disparan por el mismo hecho: la creación de una transacción. El agregado transaccional real
de este dominio no es `Transaction`; es la tripleta.

Formulación precisa: **`transactions` no depende de `accounts` y `budgets` — `transactions` es el
lugar donde vive el invariante de los tres.** Eso no se desacopla, se reconoce.

Consecuencia: la flecha `transactions → accounts/budgets` es legítima y permanente. Ninguno de los
problemas de abajo propone tocarla.

### 2. Lo que serializa entre requests es el row lock, no la instancia compartida

> Punto escrito cuando `Scope.REQUEST` todavía existía (motivó cerrar P1/P2 sin miedo a debilitar
> concurrencia). P3 eliminó `Scope.REQUEST` del todo — hoy los 4 impls son singletons y cada
> `run()` abre su propio `QueryRunner` desde el stack de la llamada. La conclusión de este punto
> sigue siendo válida, sólo cambió el mecanismo: ver "Por qué el impl vive en `transactions/`" en
> `CLAUDE.md` para la versión vigente del argumento.

`Scope.REQUEST` significaba **una instancia por request**. Por lo tanto, en ese momento, un
`PATCH /accounts/:id/archive` y un `POST /transactions` concurrentes ya tenían instancias de UoW,
`QueryRunner`s, conexiones y transacciones de DB **distintas**. Lo único que los serializaba sobre la
misma fila de cuenta era el `FOR UPDATE` de Postgres.

El `useExisting` compartido sólo garantizaba que, **dentro de un mismo request**, los repos scoped
compartieran `QueryRunner`. Eso era obligatorio para `CreateTransaction` (necesita los tres repos en
una transacción) e irrelevante para todos los demás flujos.

Consecuencia: partir el UoW en varias implementaciones **no podía debilitar ninguna garantía de
concurrencia**, porque entre requests nunca estuvo compartido.

### 3. Cada módulo con frontera transaccional propia es dueño de su UoW

Los ciclos que motivaban P1 y P2 eran un artefacto de composición, no de dominio: vivían entre los
`.module.ts` y ningún use case, entidad, repositorio ni mapper de `accounts` o `budgets` importaba
nada de `transactions`. Cerrarlos consistió en darle a cada módulo su propio UoW, con el molde de
`AuthUnitOfWorkImpl` — que ya demostraba que el patrón no cicla.

```
users ──> (nada)
auth  ──> users
categories ──> (nada)          ← hoja
accounts   ──> (nada)          ← hoja
reports    ──> (nada)          ← solo lee la vista v_period_expenses

transactions ──> accounts, categories, budgets
budgets      ──> categories
```

Grafo acíclico, cero `forwardRef`. `transactions` conserva `TypeOrmUnitOfWorkImpl` porque es el
único que compone varios agregados dentro de una misma transacción; `accounts`, `budgets` y `auth`
tienen el suyo.

Consecuencia para lo que queda: **ningún problema de abajo es de composición entre módulos.** Todos
son internos al UoW (su forma, su ciclo de vida, la amplitud de sus puertos) o a una duplicación.

---

## ¿Es necesario arreglar esto?

**No.** Y conviene decirlo con precisión para no vender el refactor con argumentos falsos.

- **¿Causa un bug hoy?** Ya no — P7 era el único y está cerrado (ver la nota al principio de este
  documento). Los que quedan no producen ninguna incorrección: la app bootea, los locks funcionan,
  la suite pasa.
- **¿Cuesta algo medible?** Poco. Los unit tests mockean los puertos, así que no sufren el
  acoplamiento; los de integración levantan la app entera de todos modos. El único con impacto de
  runtime plausible es P3 — y **no está medido en este repo**, así que el argumento sólido para
  hacerlo es P4 (seguridad del ciclo de vida), no rendimiento.

**Entonces por qué seguir:**

1. La versión barata es genuinamente barata — no toca lógica de negocio ni tests.
2. Elimina trampas latentes antes de que la base crezca.
3. Con P1 y P2 ya cerrados, P3 se puede resolver módulo por módulo en vez de como big-bang: cada
   UoW es ahora una unidad independiente que se puede convertir en runner sin estado por separado.

**Cuándo diferirlo es legítimo:** si el foco está en entregar features — los que quedan son
endurecimiento estructural, no defectos de comportamiento (ese, P7, ya está cerrado).

---

# Los problemas

> **P3 y P4 se cerraron juntos** (ver la nota de cabecera). Quedan como referencia histórica en
> `src/PLAN-P3P4-transactional-runner.md` — enunciado, evidencia, costo y la propuesta que terminó
> implementándose. Sus secciones dedicadas se retiraron de este inventario, siguiendo el mismo
> patrón que P1, P2 y P7.
>
> **P5 también se cerró** (ver la nota de cabecera). Queda como referencia histórica en
> `src/PLAN-P5-narrow-ports.md` — la derivación de qué capacidad necesita realmente cada consumidor
> vecino, la regla de estrechamiento (§2: "un puerto escopado entrega las lecturas que usa y sólo las
> escrituras sobre el agregado del que ese consumidor es responsable") y la verificación a nivel de
> tipos. Su sección dedicada se retiró de este inventario, mismo patrón.

## P6 — La definición de "gasto del período" tiene dos implementaciones

**Enunciado:** la misma query existe dos veces, en dos puertos distintos, con nombres distintos.

**Evidencia:** `ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod`
(`transactions/infrastructure/persistence/unit-of-work.impl.ts`) y
`ScopedExpenseChecker.sumExpenseAmountInPeriod`
(`budgets/infrastructure/persistence/scoped-expense-checker.ts`) son **la misma sentencia carácter
por carácter**: mismo `COALESCE(SUM(e.amount), 0)`, mismo `FROM v_period_expenses e`, mismos cuatro
filtros, mismos parámetros.

**Costo real:** bajo pero irónico. Todo el trabajo de la vista fue para tener *una* definición de
"qué cuenta como gasto"; en la capa de arriba quedaron dos métodos que la consultan idénticamente. Si
la firma cambia (excluir transferencias, por ejemplo), hay dos lugares y ningún test que detecte la
divergencia.

> **Prioridad subida — efecto colateral de cerrar P1.** Antes las dos copias vivían en el mismo
> archivo, a cien líneas de distancia: la duplicación se veía de un vistazo. Ahora viven en módulos
> distintos y una está detrás de una factory, así que es invisible. El refactor no creó la
> duplicación pero **encareció su costo**, y ese fue un trade aceptado conscientemente para mantener
> el cierre de P1 como cambio de composición puro (consolidar obligaba a tocar los fakes y un spec
> de `transactions`).

**Independencia:** total. No depende de nada de lo que queda.

**Propuesta:** un solo dueño de esa consulta. Siendo idénticas, `CreateTransaction` puede consumir la
misma capacidad que consume `UpdateBudgetLimit` — es la misma pregunta, al mismo dato, bajo el mismo
lock.

---

# Candidatos examinados y descartados

Se listan para que nadie los "arregle" después sin entender qué compran.

### Lecturas duplicadas — **trade deliberado, no defecto**

`CreateTransaction` lee la cuenta y el budget sin lock (vía los use cases globales) y los relee con
lock dentro del UoW; `DeleteTransaction` hace lo mismo con la transacción. Compra 404/403 baratos sin
tomar una conexión del pool. Cuesta round-trips en el camino feliz, y es lo que fuerza el import a
nivel *application* de los vecinos. Consciente.

### Eventos in-process / outbox para desacoplar los writes cross-aggregate — **incoherente**

Los dos writes cross-aggregate (`Σ ≤ límite` y `balance ≥ 0`) son **guards**, no proyecciones: son
compuertas condicionales sobre la escritura. Moverlos a un handler convierte "rechazar la
transacción" en "aceptar, descubrir la violación, revertir" — o sea, cambia rollback (invisible) por
compensación (visible al usuario). Y el in-process no rescata nada: o el handler corre dentro de la
misma transacción (mismo acoplamiento, peor trazabilidad), o corre post-commit sin cola durable
(consistencia eventual sin durabilidad — dual-write con cola en memoria).

Además, `Σ gastos ≤ límite` es un invariante sobre un conjunto de filas: no es expresable como
constraint de DB, así que exige read-then-write bajo serialización. Las tres formas de imponerlo
(lock pesimista sobre fila-mutex, `SERIALIZABLE` + retry, o materializar la suma con `CHECK`) son
síncronas y transaccionales.

### Balance como estado derivado (`SUM` de transacciones) — **incoherente por futilidad**

No agrega eventualidad, pero tampoco elimina la transacción: el balance **también es un guard**
(`InsufficientFundsException` en `outflow()`). El flujo derivado sigue siendo read-then-write con las
mismas carreras y la misma necesidad de serializar. Cambia una lectura O(1) con lock por un agregado
O(n) con el mismo lock. Más caro, cero desacople ganado.

### `AsyncLocalStorage` / propagación transaccional implícita — **incoherente para este proyecto**

Resolvería P3, P4 y P5 de raíz, pero volviendo implícito el mecanismo más delicado del sistema.
En una base cuyo activo documental principal es el mapa explícito de locks y serialización, cambiar
explícito por implícito es un retroceso de legibilidad. Y no resuelve el ownership: lo esconde.

> **Matiz post-cierre de P3+P4:** el runner que cerró P3 y P4 sí usa `AsyncLocalStorage`
> (`activeTransaction`, `shared/infrastructure/persistence/active-transaction.storage.ts`) — pero no
> para esto. Lo rechazado acá es usar el ALS **para propagar** el contexto transaccional (que un
> caller reciba un `EntityManager`/`QueryRunner` de forma ambiental, sin un parámetro explícito). Lo
> que el runner hace es distinto: el ALS lleva sólo `{ owner: string }` y su único efecto es detectar
> un `run()` anidado en la misma cadena async y lanzar antes de abrir un segundo `QueryRunner`. El
> contexto transaccional (`ctx`) sigue viajando exclusivamente como parámetro explícito del callback
> de `run()`. Ver CLAUDE.md, "Anti-patterns", para la distinción completa.

---

# Mapa de dependencias entre problemas

```
P6  ────────────────────────────  independiente
```

P3 y P4 (que eran mutuamente dependientes — "misma solución: una cirugía compra las dos") y P5 (que
dependía sólo de que P3 + P4 hubiera fijado la forma final del contexto) ya cerraron. Sólo queda P6,
que no depende de nada más.

| Problema | Costo | Riesgo | Naturaleza |
| -------- | ----- | ------ | ---------- |
| **P6** Query de gastos duplicada | bajo | nulo | duplicación |

> **Cierre de P5, para quien busque el orden histórico.** El plan de P5 (`PLAN-P5-narrow-ports.md`)
> proponía hacerlo *antes* de P3 + P4; el plan de P3 + P4 asumía que P5 seguía diferido. Se ejecutó
> **P3 + P4 → P5**: P3 + P4 cerró primero (`PLAN-P3P4-transactional-runner.md`, commits 1-8), y P5 se
> retomó después sobre el estado post-runner (`PLAN-P5-narrow-ports.md` §10.3 registra el ajuste: los
> puntos donde se acotó el puerto ya no eran los getters `getScopedAccountRepository()` /
> `getScopedBudgetRepository()` que el plan original describía, sino las propiedades `ctx.accounts` /
> `ctx.budgetPeriodReader` que `createContext()` construye — el punto de entrada, el tipo de retorno
> de `createScopedAccountRepository` / `createScopedBudgetRepository` (más la nueva
> `createScopedBudgetPeriodReader`), no se movió; sólo cambió quién lo invoca y cómo se expone el
> resultado).

**Cada parada es un estado coherente.** Con P7 cerrado, el sistema ya es *más correcto*. Con P3 + P4
cerrados, es *más seguro de extender* (menos superficie para un `release()` olvidado, sin contagio
de `Scope.REQUEST`). Con P5 cerrado, los puertos que cruzan agregados vecinos ya no pueden, por tipo,
escribir o borrar lo que no les pertenece. Lo que queda (P6) es una duplicación de query, no
corrección de un defecto de comportamiento.
