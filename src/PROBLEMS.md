# Inventario de problemas estructurales

> Descomposición del acoplamiento entre `transactions`, `accounts`, `budgets` y `auth` en problemas
> **independientes y accionables**. Cada uno tiene enunciado, evidencia en código, costo real,
> grado de independencia, propuesta y criterio de verificación.
>
> Esto **no** es un plan de ejecución. Es el mapa de qué problema específico se está resolviendo
> con cada movimiento, para no confundir causas con síntomas.

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

### 3. El ciclo es un artefacto de composición, no de dominio

El único ciclo a nivel de archivo `.ts` es entre los tres `.module.ts`. Ningún use case, entidad,
repositorio ni mapper de `accounts` o `budgets` importa nada de `transactions`.

```
users ──> (nada)
auth  ──> users
categories ──> (nada)          ← hoja
reports ──> (nada)             ← solo lee la vista v_period_expenses

   accounts  ◄────────────────  transactions      ciclo (forwardRef en ambos extremos)
        └──────────────────────>     ▲
                                     │
                    budgets ◄────────┘             ciclo (forwardRef en ambos extremos)
                       └─────────────>
```

- `transactions ↔ accounts`: `transactions.module.ts:32` ↔ `accounts.module.ts:29`
- `transactions ↔ budgets`: `transactions.module.ts:34` ↔ `budgets.module.ts:23`

`auth` tiene su propio UoW (`AuthUnitOfWorkImpl`) y por eso es acíclico. Es la prueba de que el
patrón puede no ciclar.

---

## ¿Es necesario arreglar esto?

**No.** Y conviene decirlo con precisión para no vender el refactor con argumentos falsos.

- **¿Causa un bug hoy?** Solo P7. Los demás no producen ninguna incorrección: la app bootea, los
  locks funcionan, la suite pasa.
- **¿Cuesta algo medible?** Poco. Los unit tests mockean los puertos, así que no sufren el
  acoplamiento; los de integración levantan la app entera de todos modos. El único costo con impacto
  de runtime real es P3, y **P3 no lo causa el ciclo**.

**Entonces por qué hacerlo:**

1. La versión barata es genuinamente barata — no toca lógica de negocio ni tests.
2. Elimina trampas latentes antes de que la base crezca.
3. Hace que la composición diga lo que el dominio ya dice: `IAccountUnitOfWork` vive en
   `accounts/domain`, lo cual afirma que accounts es dueño de su contrato transaccional. Que la
   implementación venga de `transactions` contradice esa afirmación.
4. Habilita que P3 se resuelva módulo por módulo en vez de como big-bang.

**Cuándo diferirlo es legítimo:** si el foco está en entregar features y el ciclo nunca mordió.
Excepto P7, que es un defecto de comportamiento.

---

# Los problemas

## P1 — Binding cruzado de tokens transaccionales

**Enunciado:** un módulo declara y exporta providers para tokens de otros bounded contexts, que esos
contextos podrían auto-implementar.

**Evidencia:** `transactions.module.ts:67-70` provee `IBudgetUnitOfWork` y `71-74` provee
`IAccountUnitOfWork`; la línea 76 los exporta. **`transactions` no inyecta ninguno de los dos en
ningún lado** — existen exclusivamente para alimentar a los vecinos, que a cambio deben importar el
módulo entero (`accounts.module.ts:29`, `budgets.module.ts:23`).

**Costo real:** dos ciclos, cuatro `forwardRef`, y una trampa latente de evaluación CommonJS entre
los tres `.module.ts` (hoy inocua porque solo exportan clases decoradas; deja de serlo si alguien
agrega una `const` de nivel superior derivada de otro módulo). Ningún bug actual. El costo es de
escalabilidad estructural.

**Independencia:** independiente de todos los demás.

**Propuesta:** cada módulo implementa su propio UoW.

1. Mover `ScopedExpenseChecker` a `budgets/infrastructure`. Su constructor recibe solo
   `EntityManager` y sus dos métodos consultan `v_period_expenses` con SQL crudo — no importa
   `TransactionOrmEntity`, ni `TransactionMapper`, ni nada de transactions. Desde que existe la
   vista, la razón por la que vive ahí ya se evaporó; solo no se movió el archivo. `reports` ya
   demuestra el patrón: lee la misma vista con cero acoplamiento de compilación.
2. `AccountUnitOfWorkImpl` en `accounts` y `BudgetUnitOfWorkImpl` en `budgets`, con el molde exacto
   de `AuthUnitOfWorkImpl`.
3. `transactions` conserva su UoW multi-agregado.

**Fundamento:** hechos 2 y 3 del marco previo. Además, verificado caso por caso:
`Archive`/`Unarchive`/`Rename` usan **únicamente** `getScopedAccountRepository()`;
`DeleteBudget`/`UpdateBudgetLimit` usan **únicamente** `getScopedBudgetRepository()` + el expense
checker. Ninguno de los cinco necesita una transacción compartida con nadie. La frontera
multi-agregado es exclusiva de `transactions`.

**Los puertos no se tocan.** `IAccountUnitOfWork` y `IBudgetUnitOfWork` ya están donde deben.

**Prueba de que funcionó:** los tests de concurrencia de Race 1/2/3 pasan sin modificarse, y
`accounts.module.ts` / `budgets.module.ts` no importan `transactions`.

---

## P2 — Política de lock escrita fuera del módulo dueño

**Enunciado:** el `FOR UPDATE` que protege el invariante de un agregado está escrito en el archivo de
otro módulo.

**Evidencia:** `ScopedAccountRepository.findById` (lock de la fila de cuenta, mecanismo de la Race 2)
y `ScopedBudgetRepository.findById` / `findByUserIdAndCategoryIdAndPeriod` (el mutex lógico del
invariante de período) viven los tres en
`transactions/infrastructure/persistence/unit-of-work.impl.ts`.

**Costo real:** descubribilidad y riesgo de deriva. Quien mantiene `accounts` no encuentra en su
módulo la razón por la que su fila se bloquea. Si el repo scoped se duplicara en dos lugares, el
mecanismo de la Race 2 quedaría con dos fuentes de verdad.

**Por qué es distinto de P1:** P1 es ownership del *binding de DI*; P2 es ownership del *código*. Se
pueden resolver por separado — mover el impl a un módulo neutral resolvería P1 y dejaría P2 intacto.

**Propuesta:** cada módulo publica su clase scoped, y el UoW de `transactions` las **compone** sobre
su propio `QueryRunner`:

```ts
new ScopedAccountRepository(this.queryRunner.manager, this.accountMapper)
```

Dirección `transactions → accounts/budgets`, que ya existe. Sin ciclo.

**Tensión honesta a decidir — la única decisión de diseño real del refactor:** hoy la regla es que
las clases scoped son privadas al archivo del impl, y la única forma de obtenerlas es a través del
UoW. Publicarlas la afloja: nada impediría que alguien construya una con `dataSource.manager` en
autocommit, y el `FOR UPDATE` se evaporaría en silencio. Mitigación posible: exponer una factory
acotada en vez de la clase cruda.

**Alternativa descartada:** que `transactions` mantenga copias privadas. Duplica el `FOR UPDATE` de
la fila de cuenta en dos archivos — exactamente la deriva que se quiere evitar.

---

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

**Secuencia importante:** después de P1 esto es incremental, módulo por módulo. Antes de P1 es un
big-bang sobre una clase de la que dependen tres módulos.

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

`isActive()` existe en ambos impls y **no se usa en ningún lado**.

**Costo real:** la corrección depende de copiar bien el patrón. Un `release()` olvidado filtra una
conexión del pool **de forma permanente** — no se recupera hasta reiniciar el proceso. Los 8 están
correctos hoy; el noveno es el riesgo. Un doble `begin()` filtra el `QueryRunner` anterior sin
ninguna señal.

**Por qué es distinto de P3:** P3 es sobre el *scope de DI*; P4 es sobre la *seguridad del ciclo de
vida*.

**Propuesta:** el mismo runner por callback de P3. Hace estructuralmente imposible olvidar el
`release()` y elimina la reentrada. **Una sola cirugía compra P3 y P4** — ése es el mejor argumento
a favor de hacerla.

**Endurecimiento inmediato si se difiere:** `if (this.isActive()) throw` al inicio de `begin()`.

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
Encaja naturalmente con P2: el módulo dueño publica la capacidad acotada en vez de la clase completa.

---

## P6 — La definición de "gasto del período" tiene dos implementaciones

**Enunciado:** la misma query existe dos veces, en dos puertos distintos, con nombres distintos.

**Evidencia:** `ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod` y
`ScopedExpenseChecker.sumExpenseAmountInPeriod` son **la misma sentencia carácter por carácter**:
mismo `COALESCE(SUM(e.amount), 0)`, mismo `FROM v_period_expenses e`, mismos cuatro filtros, mismos
parámetros.

**Costo real:** bajo pero irónico. Todo el trabajo de la vista fue para tener *una* definición de
"qué cuenta como gasto"; en la capa de arriba quedaron dos métodos que la consultan idénticamente. Si
la firma cambia (excluir transferencias, por ejemplo), hay dos lugares y ningún test que detecte la
divergencia.

**Independencia:** se hace evidente al hacer P1, pero se puede consolidar antes.

**Propuesta:** un solo dueño de esa consulta. Siendo idénticas, `CreateTransaction` puede consumir la
misma capacidad que consume `UpdateBudgetLimit` — es la misma pregunta, al mismo dato, bajo el mismo
lock.

---

## P7 — Reacción secundaria dentro del alcance de error de la transacción

> **Único defecto de comportamiento del inventario. Los demás son estructurales.**

**Enunciado:** la invalidación de caché ocurre después del `commit()` pero **dentro del `try`**, así
que su fallo dispara un `rollback()` sobre una transacción ya commiteada.

**Evidencia:** `delete-budget.use-case.ts:50-59` y `update-budget-limit.use-case.ts:62-71`.

```ts
await budgetRepo.delete(id);
await this.uow.commit();

await Promise.all([                      // ← si esto lanza…
  this.cache.invalidateUser(budget.userId),
  this.cache.invalidateById(id),
]);
} catch (error) {
await this.uow.rollback();               // ← …rollback sobre una tx cerrada
throw error;
}
```

**Costo real:** si Redis está caído, `invalidateUser` lanza → cae al `catch` → `rollback()` sobre una
transacción cerrada → TypeORM lanza `TransactionNotStartedError`, que **enmascara el error original**
y se propaga. Resultado: el budget se borró correctamente, la caché quedó stale, y el cliente recibe
un 500 con un error engañoso sobre una operación que en realidad tuvo éxito. **Una caída de Redis
convierte borrados exitosos en 500s.**

**Independencia:** total. Es el arreglo más barato y el único que corrige un comportamiento
incorrecto.

**Propuesta:** la reacción secundaria va fuera del alcance transaccional — después del `finally`, o
en su propio `try/catch` que solo loguee. El criterio ya está bien establecido en el resto del
código: lo que protege un invariante va adentro, lo que tolera latencia y fallo va afuera. Acá quedó
del lado equivocado de la llave.

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

Resolvería P2, P3, P4 y P5 de raíz, pero volviendo implícito el mecanismo más delicado del sistema.
En una base cuyo activo documental principal es el mapa explícito de locks y serialización, cambiar
explícito por implícito es un retroceso de legibilidad. Y no resuelve el ownership: lo esconde.

### UoW a un módulo de persistencia neutral — **coherente pero inferior a P1**

Rompe ambos ciclos y es más barato. Pero institucionaliza una afirmación falsa: "existe un contexto
transaccional compartido para todo el núcleo financiero", cuando `accounts` y `budgets` son
demostrablemente autosuficientes. Además crea un módulo que debe importar todas las ORM entities y
mappers —un nuevo hub de acoplamiento— y el UoW multi-agregado sobrevive intacto, solo que mudado.
Es el fallback si no se quiere tocar la estructura interna del UoW.

---

# Mapa de dependencias entre problemas

```
P7  ────────────────────────────  independiente · defecto · arreglo inmediato
P5  ────────────────────────────  independiente
P6  ────────────────────────────  independiente (se hace obvio con P1)

P1 ──┬──> P2   P2 se resuelve naturalmente al hacer P1 bien
     └──> P3   P1 primero hace a P3 incremental en vez de big-bang

P3 ══ P4       misma solución: una cirugía compra las dos
```

| Problema | ¿Rompe el ciclo? | Costo | Riesgo | Naturaleza |
| -------- | ---------------- | ----- | ------ | ---------- |
| **P7** Reacción secundaria dentro del `try` | no | mínimo | nulo | defecto de comportamiento |
| **P1** Binding cruzado de tokens | sí, ambas aristas | medio | bajo | estructural |
| **P2** Lock policy fuera de su módulo | — | incluido en P1 | bajo | ownership |
| **P6** Query de gastos duplicada | no | bajo | nulo | duplicación |
| **P3** Contagio de `Scope.REQUEST` | no | medio | medio | runtime |
| **P4** Ciclo de vida manual sin guarda | no | incluido en P3 | medio | robustez |
| **P5** Puerto sobre-expuesto | no | bajo | nulo | endurecimiento |

**Orden sugerido:** P7 → P1 + P2 → P6 → P3 + P4 → P5.

**Cada parada es un estado coherente.** Después de P7 el sistema es *más correcto*. Después de
P1 + P2 es *estructuralmente honesto*. Después de P3 + P4 es *más rápido y más seguro de extender*.
