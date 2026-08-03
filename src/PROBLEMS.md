# Inventario de problemas estructurales

> Descomposición del acoplamiento entre `transactions`, `accounts`, `budgets` y `auth` en problemas
> **independientes y accionables**. Cada uno tiene enunciado, evidencia en código, costo real,
> grado de independencia, propuesta y criterio de verificación.
>
> Esto **no** es un plan de ejecución. Es el mapa de qué problema específico se está resolviendo
> con cada movimiento, para no confundir causas con síntomas.
>
> **P1, P2 y P7 están cerrados** y se eliminaron de este inventario. P1 y P2 rompían los dos ciclos
> de módulos dando a `accounts` y a `budgets` su propio UoW; el resultado vive en el código y en la
> sección de concurrencia de `CLAUDE.md`. P7 (la invalidación de caché disparando un `rollback()`
> sobre una transacción ya commiteada) se cerró con `PLAN-P7-cache-rollback.md`: la invalidación
> ahora corre en su propio `try/catch` post-commit (ver `CLAUDE.md`, "Anti-patterns"), y `rollback()`
> es no-op sobre una transacción ya cerrada en los cuatro impls de UoW. Los problemas que quedan son
> internos al UoW o al ciclo de vida transaccional — ninguno es de composición entre módulos.

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

`Scope.REQUEST` significa **una instancia por request**. Por lo tanto, hoy mismo, un
`PATCH /accounts/:id/archive` y un `POST /transactions` concurrentes ya tienen instancias de UoW,
`QueryRunner`s, conexiones y transacciones de DB **distintas**. Lo único que los serializa sobre la
misma fila de cuenta es el `FOR UPDATE` de Postgres.

El `useExisting` compartido solo garantiza que, **dentro de un mismo request**, los repos scoped
compartan `QueryRunner`. Eso es obligatorio para `CreateTransaction` (necesita los tres repos en una
transacción) e irrelevante para todos los demás flujos.

Consecuencia: partir el UoW en varias implementaciones **no puede debilitar ninguna garantía de
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

**Cuándo diferirlo es legítimo:** si el foco está en entregar features — los cuatro que quedan son
endurecimiento estructural, no defectos de comportamiento (ese, P7, ya está cerrado).

---

# Los problemas

## P3 — UoW como objeto con estado → contagio de `Scope.REQUEST`

**Enunciado:** el UoW guarda el `QueryRunner` en un campo mutable, lo que obliga a `Scope.REQUEST`,
que burbujea hasta los controllers.

**Evidencia:** `unit-of-work.impl.ts:254` (`@Injectable({ scope: Scope.REQUEST })`) y `:259`
(`private queryRunner: QueryRunner | null`). Lo mismo en `auth-unit-of-work.impl.ts:60,62` y
`auth.module.ts:70`.

```
TypeOrmUnitOfWorkImpl (REQUEST)
  → IAccountUnitOfWork  → Archive/Unarchive/Rename      → AccountsController     (REQUEST)
  → IBudgetUnitOfWork   → DeleteBudget/UpdateBudgetLimit → BudgetsController      (REQUEST)
  → ITransactionUnitOfWork → Create/DeleteTransaction    → TransactionsController (REQUEST)

AuthUnitOfWorkImpl (REQUEST)
  → IAuthUnitOfWork     → RefreshToken                   → AuthController         (REQUEST)
```

**Costo real — el único con impacto de runtime medible.** De los 7 controllers de dominio, **4 se
instancian por request**: auth, accounts, budgets, transactions. Quedan limpios users, categories y
reports. Un `GET /accounts` o un `POST /auth/login` —operaciones que jamás abren una transacción—
pagan la resolución del árbol de DI en cada llamada, solo porque comparten controller con un endpoint
que sí la abre. La granularidad del scope es el controller; la necesidad real son 8 use cases de
escritura. No hay *durable providers* configurados (no aparece `ContextIdFactory` ni `durable` en
todo `src/`).

**Independencia: total respecto del ciclo.** No lo causa y no lo arregla. Es el error de atribución
más fácil de cometer acá — no mezclar los argumentos.

**Propuesta:** convertir el UoW en un runner sin estado: `run(work => …)` que abre la transacción,
entrega un contexto con los repos scoped, y hace commit o rollback según si el callback lanzó. Si el
`QueryRunner` vive en el stack de la llamada en vez de en un campo, el provider es stateless y puede
ser singleton.

**Secuencia:** esto ya es incremental. Con cada módulo dueño de su UoW, convertir uno en runner sin
estado es trabajo module-local; antes habría sido un big-bang sobre una clase de la que dependían
tres módulos.

**Prueba de que funcionó:** ningún provider con `Scope.REQUEST` en el grafo; los 4 controllers
vuelven a instanciarse una sola vez.

---

## P4 — Ciclo de vida transaccional manual, replicado 8 veces, sin guarda de reentrada

**Enunciado:** cada use case transaccional repite a mano
`begin` / `try` / `commit` / `catch` / `rollback` / `finally` / `release`, y `begin()` no verifica si
ya hay una transacción activa.

**Evidencia:** el mismo bloque en `CreateTransaction`, `DeleteTransaction`, `Archive`, `Unarchive`,
`Rename`, `DeleteBudget`, `UpdateBudgetLimit`, `RefreshToken`. Y:

```ts
async begin(): Promise<void> {
  this.queryRunner = this.dataSource.createQueryRunner();  // pisa el anterior sin avisar
  await this.queryRunner.connect();
  await this.queryRunner.startTransaction();
}
```

`isConnected()` existe en ambos impls y **no se usa en ningún lado**.

**Costo real:** la corrección depende de copiar bien el patrón. Un `release()` olvidado filtra una
conexión del pool **de forma permanente** — no se recupera hasta reiniciar el proceso. Los 8 están
correctos hoy; el noveno es el riesgo. Un doble `begin()` filtra el `QueryRunner` anterior sin
ninguna señal.

**Por qué es distinto de P3:** P3 es sobre el *scope de DI*; P4 es sobre la *seguridad del ciclo de
vida*.

**Propuesta:** el mismo runner por callback de P3. Hace estructuralmente imposible olvidar el
`release()` y elimina la reentrada. **Una sola cirugía compra P3 y P4** — ése es el mejor argumento
a favor de hacerla.

**Endurecimiento inmediato si se difiere:** `if (this.isConnected()) throw` al inicio de `begin()`.

---

## P5 — Puerto transaccional sobre-expuesto

**Enunciado:** el UoW de transacciones entrega los puertos de repositorio **completos** de los
agregados vecinos, incluyendo operaciones que sus consumidores nunca deberían poder invocar.

**Evidencia:** `transactions/domain/ITransactionUnitOfWork.ts:20-21` devuelve `IAccountRepository` e
`IBudgetRepository` enteros — con `save()` y `delete()`. Por tipo, `CreateTransactionUseCase` puede
borrar una cuenta o un budget dentro de su transacción. Nada lo impide.

**Costo real:** ninguno hoy (nadie abusa). Es una frontera declarada pero no impuesta. Lo relevante
es que **el repo ya decidió que esto importa**: `ITransactionRepository` fue partido en puerto de
query y `IScopedTransactionRepository` de comando, precisamente para que el repo global no pueda
escribir fuera del UoW *y esté impuesto por tipos*. La misma disciplina no se aplicó a los vecinos.

**Independencia:** total. Se puede hacer sin tocar nada más.

**Propuesta:** puertos de comando acotados. `transactions` no necesita `IAccountRepository`; necesita
"leer con lock + guardar balance" — dos métodos. Idem budget: "leer con lock por tupla natural".

**El punto de entrada ya existe:** el tipo de retorno de `createScopedAccountRepository` y
`createScopedBudgetRepository` es exactamente donde se estrecha el puerto, y ninguna otra llamada
tiene que cambiar. Hoy devuelven el repositorio completo para no ampliar el alcance del refactor que
las creó. El precedente de la forma final es `IScopedTransactionRepository`
(`transactions/domain/repository/scoped-transaction.repository.ts`): puerto de consulta separado del
de comando, y el de comando nunca es token de DI.

---

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

---

# Mapa de dependencias entre problemas

```
P6  ────────────────────────────  independiente
P5  ────────────────────────────  independiente

P3 ══ P4       misma solución: una cirugía compra las dos
```

Los tres restantes son mutuamente independientes salvo P3 ══ P4. Cerrar P1 y P2 dejó cada UoW
como una unidad separada, así que P3 + P4 se puede hacer módulo por módulo en vez de como big-bang.

| Problema | Costo | Riesgo | Naturaleza |
| -------- | ----- | ------ | ---------- |
| **P6** Query de gastos duplicada | bajo | nulo | duplicación |
| **P5** Puerto sobre-expuesto | bajo | nulo | endurecimiento |
| **P3** Contagio de `Scope.REQUEST` | medio | medio | runtime |
| **P4** Ciclo de vida manual sin guarda | incluido en P3 | medio | robustez |

**Orden sugerido:** P6 → P3 + P4 → P5.

P6 primero, porque el cierre de P1 lo encareció y sigue encareciéndose. P5 al final: el tipo de
retorno de las factories scoped es el punto exacto donde se estrecha el puerto, y conviene tocarlo
una sola vez.

> **Discrepancia abierta:** el plan de P5 propone hacerlo *antes* de P3 + P4; el plan de P3 + P4
> asume que P5 sigue diferido. Hay que resolverla antes de empezar cualquiera de los dos.

**Cada parada es un estado coherente.** Con P7 cerrado, el sistema ya es *más correcto*. Después de
P3 + P4 es *más seguro de extender*.
