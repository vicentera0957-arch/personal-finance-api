# PLAN — Reconciliación documental del refactor P1/P2

> Complemento de `src/PLAN-P1P2-budgets.md` (§4.5 listaba 12 ubicaciones, alcance budgets) y del plan
> hermano de accounts. Este documento es el barrido **completo** y la resolución de los casos que
> §4.5 dejó abiertos: el ADR-0003, el anti-patrón nuevo, y las tablas de `CLAUDE.md`.
>
> Regla que gobierna todo esto (`CLAUDE.md:5`): *"When the code and this doc disagree, the code wins
> — but open a PR to fix the doc in the same change."* El objetivo no es maquillar: es que ningún
> lector futuro reconstruya un modelo mental falso a partir de un doc.

---

## 0. Alcance, método y corrección de la cifra

**Método:** barrido sobre todos los `.md` del repo (excluyendo `node_modules/`) buscando
`TypeOrmUnitOfWorkImpl|ScopedExpenseChecker|ScopedBudgetRepository|ScopedAccountRepository|IExpenseChecker|IBudgetUnitOfWork|IAccountUnitOfWork|forwardRef|useExisting|port owned by consumer`,
más lectura completa de los documentos con impacto estructural.

**Corrección honesta de la cifra:** las "12 ubicaciones" eran el recuento del plan de budgets, acotado
a lo que ese refactor invalida. El barrido completo da **33 ubicaciones en 14 archivos**, repartidas así:

| Grupo | Qué es | Cantidad | Cuándo se puede arreglar |
| --- | --- | --- | --- |
| **A** | Ya falsas **hoy** — deuda preexistente, no la causa el refactor | 9 en 6 archivos | **Ya**, sin esperar código |
| **B1** | Quedan falsas con el refactor de **budgets** solo | 11 en 5 archivos | Con el PR de budgets |
| **B2** | Requieren budgets **y** accounts para quedar correctas | 13 en 6 archivos | Después de ambos |
| **C** | Histórico — **no se tocan** | 5 archivos | Nunca |

Y un hallazgo negativo relevante: **`docs/adr/0002-unit-of-work-pessimistic-locks.md` sobrevive
intacto.** Su "Fact from the code" (`:19-25`) cita `CreateTransactionUseCase`, los scoped repos
compartiendo un `QueryRunner` y la fila de budget como mutex lógico — las tres siguen siendo ciertas.
Su `Decision` (`:29-32`) y su trade-off *"only the scoped repos lock; the global repo does not"*
(`:58`) tampoco cambian. **No hay que tocarlo**, y conviene decirlo para que nadie lo "actualice"
por asociación.

---

## 1. Inventario

### Grupo A — ya falsas hoy (deuda preexistente)

Ninguna la causa el refactor. Son errores de transcripción o derivas de renombres pasados. **Se
pueden arreglar en un commit independiente que no depende de nada.**

| # | Ubicación | Afirma hoy | Realidad verificada | Reemplazo |
| --- | --- | --- | --- | --- |
| A1 | `README.md:106` | `transactions -. IExpenseChecker / IAccountUnitOfWork .-> accounts` | `IExpenseChecker` está en `budgets/domain/repository/expense-checker.port.ts:4`, **no** en accounts. La arista mezcla dos módulos distintos en una sola flecha | Separar en dos aristas etiquetadas, o —mejor— borrarla al hacer B2-20 |
| A2 | `CLAUDE.md:155` | `getAccountRepository()` → `ScopedAccountRepository` | el método se llama `getScopedAccountRepository()` (`unit-of-work.impl.ts:301`) | corregir el nombre |
| A3 | `CLAUDE.md:156` | `getBudgetRepository()` | `getScopedBudgetRepository()` (`unit-of-work.impl.ts:308`) | corregir el nombre |
| A4 | `src/modules/budgets/notes.md:52` | *"Implementado en `transactions/infrastructure/persistence/expense-checker.implement.ts`"* | **ese archivo no existe.** `ls src/modules/transactions/infrastructure/persistence/` devuelve 6 archivos + `__fakes__`, ninguno es `expense-checker.implement.ts`. La impl está en `unit-of-work.impl.ts:188` | queda absorbido por B1-21 |
| A5 | `src/modules/budgets/notes.md:121` | *"transactions.module.ts: exports IExpenseChecker"* | `transactions.module.ts:76` exporta `[ITransactionUnitOfWork, IBudgetUnitOfWork, IAccountUnitOfWork]` — `IExpenseChecker` **nunca** estuvo ahí | absorbido por B1-21 |
| A6 | `src/modules/transactions/notes.md:185` | *"Exports: `IExpenseChecker`"* | idem A5 | absorbido por B1-22 |
| A7 | `src/modules/transactions/notes.md:142-143` | `getAccountRepository()` / `getBudgetRepository()` | nombres reales con prefijo `getScoped…` | corregir |
| A8 | `src/modules/accounts/notes.md:98` | `this.uow.getAccountRepository()` | `archive-account.use-case.ts:20` llama `getScopedAccountRepository()`; el puerto lo declara así en `IAccountUnitOfWork.ts:5` | corregir *(alcance accounts)* |
| A9 | `docs/concurrency-model.md:80` | `ScopedTransactionRepository.findById` | el método es `findByIdWithLock` (`unit-of-work.impl.ts:43`; el puerto lo declara en `scoped-transaction.repository.ts:10`) | corregir |

> **Deriva colateral fuera de alcance, anotada para no perderla:** `src/modules/budgets/notes.md:33`
> cita la migración `1745366400000-AddBudgetUniqueConstraint.ts`. `ls src/database/migrations/`
> devuelve **dos** archivos (`1780590020486-InitialSchema.ts`, `1783292601885-CreatePeriodExpensesView.ts`);
> la constraint vive en `InitialSchema`. No es UoW, no entra en este plan — abrir issue aparte.

### Grupo B1 — quedan falsas con el refactor de budgets

| # | Ubicación | Afirma hoy | Por qué queda falsa | Reemplazo propuesto |
| --- | --- | --- | --- | --- |
| B1-1 | `CLAUDE.md:66` | *"plus the cycle resolved via the 'port owned by consumer' pattern"* | tras budgets **+** accounts no queda ningún ciclo. Con budgets solo, queda uno (accounts) | reescribir cuando ambos landeen (→ B2); con budgets solo, ajustar a *"el ciclo restante (accounts ↔ transactions)"* |
| B1-2 | `CLAUDE.md:98-105` (§5 completa) | el patrón "port owned by consumer" con `IExpenseChecker` como ejemplo | ver §2: el patrón queda **sin ninguna instancia viva** | sustituir la sección entera por la regla de la factory acotada (§5.3) |
| B1-3 | `CLAUDE.md:129` | `IBudgetUnitOfWork` … implementado por `TypeOrmUnitOfWorkImpl` | pasa a `BudgetUnitOfWorkImpl` | tabla nueva en §5.1 |
| B1-4 | `CLAUDE.md:133-140` | *"One class implements three module ports… wired via `useExisting`"* + bloque de código | pasa a una impl por módulo, sin `useExisting` cruzado | §5.1 |
| B1-5 | `CLAUDE.md:150-160` | *"The transactional UoW exposes four scoped resources"* | los cuatro se reparten entre tres módulos | §5.2 |
| B1-6 | `CLAUDE.md:172-173, 176-177` | filas de `ScopedBudgetRepository` y `ScopedExpenseChecker` en el mapa de locking | **la semántica de lock no cambia**; cambia dónde vive la clase | §5.2 — sólo se añade columna de ubicación |
| B1-7 | `CLAUDE.md:193` | Race 1: *"`DeleteBudget` runs inside `IBudgetUnitOfWork`; `getScopedExpenseChecker()` … same `QueryRunner`"* | sigue siendo cierto conceptualmente; falso el impl implícito | añadir *"(servido por `BudgetUnitOfWorkImpl`)"* |
| B1-8 | `CLAUDE.md:196` | B4: `ScopedExpenseChecker.sumExpenseAmountInPeriod` | ubicación | idem |
| B1-9 | `CLAUDE.md:362` | anti-patrón: *"add a getter to `TypeOrmUnitOfWorkImpl` (or `AuthUnitOfWorkImpl` for auth-only flows)"* | son cuatro impls | *"…al impl de UoW de tu propio módulo"* |
| B1-10 | `src/modules/budgets/notes.md:35, 50-53, 107, 113-125` | `IExpenseChecker` implementado en transactions; `BudgetsModule` importa `TransactionsModule` con `forwardRef`; sección entera *"Dependency inversion: the budgets ↔ transactions cycle"* | budgets deja de importar transactions | reescribir §wiring y **borrar** la sección de inversión, reemplazada por *"budgets es autosuficiente; transactions consume sus factories"* |
| B1-11 | `src/modules/transactions/notes.md:115-144, 184-185` | *"satisfies **three** module ports"*, *"the four scoped resources"*, *"The four classes are private to the file"*, exports | dos de las cuatro clases dejan de estar en el archivo; los puertos servidos bajan a uno (+`IAccountUnitOfWork` hasta que landee accounts) | reescribir; el párrafo *"private to the file… justifies the `!`"* (`:146-148`) se reformula sobre la factory |

Además, dependiente de **P6** (mismo PR, commit 4 del plan de budgets):

| # | Ubicación | Afirma | Queda falsa porque | Reemplazo |
| --- | --- | --- | --- | --- |
| B1-12 | `src/modules/reports/notes.md:83` | *"read by both `GET /reports/summary` and the three aggregate queries in `TypeOrmUnitOfWorkImpl`"* | tras P6 son **dos** métodos (`hasExpensesInPeriod`, `sumExpenseAmountInPeriod`) en `budgets/infrastructure`, consumidos desde tres llamadores | *"…y los dos agregados de enforcement de `ScopedExpenseChecker` (`budgets/infrastructure`), consumidos por `DeleteBudget`, `UpdateBudgetLimit` y `CreateTransaction`"* |
| B1-13 | `src/modules/transactions/notes.md:214` | contrasta `sumExpenseAmountByUserCategoryAndPeriod` con *"las versiones equivalentes en `ScopedExpenseChecker`"* | tras P6 ya no hay dos versiones: es una sola | colapsar el párrafo a una sola descripción |
| B1-14 | `CLAUDE.md:336` | el puerto de comando `IScopedTransactionRepository` incluye `sum…` | P6 lo saca del puerto | quitar `sum` de la enumeración |
| B1-15 | `CLAUDE.md:181` (nota de la vista) | *"The three aggregate rows above"* | pasan a ser dos | ajustar el conteo |

### Grupo B2 — requieren budgets **y** accounts

Estas **no se pueden escribir correctamente con un solo módulo refactorizado**: son narrativa o
diagramas que describen los dos ciclos como una sola figura. Reescribirlas dos veces produce un
estado intermedio falso y un conflicto de merge garantizado entre los dos PRs.

| # | Ubicación | Qué afirma | Reemplazo |
| --- | --- | --- | --- |
| B2-16 | `docs/architecture.md:52-74` | grafo mermaid con **dos** aristas `forwardRef` (`:64-65`) + `linkStyle 5,6` + prosa *"There are two cycles… both are deliberate"* | grafo acíclico; borrar `linkStyle`; prosa nueva: *"no cycles; each module owns its transactional boundary"* |
| B2-17 | `docs/architecture.md:76-137` (§2.1 completa) | sección + mermaid + tabla de tres puertos invertidos (`:132-134`) | **borrar la sección**; reemplazar por §"Cada módulo es dueño de su frontera transaccional" con el diagrama de factories |
| B2-18 | `docs/architecture.md:139-176` (§2.2 completa) | mismo patrón para accounts | idem *(alcance accounts)* |
| B2-19 | `docs/architecture.md:96-97, 74` | enlaces a ADR-0003 | apuntar al ADR nuevo (§2) |
| B2-20 | `README.md:94-96, 105-106` | prosa *"the `accounts ↔ transactions` cycle is resolved with a 'port owned by consumer' pattern"* + mermaid con dos aristas punteadas | grafo acíclico + prosa nueva |
| B2-21 | `docs/concurrency-model.md:57-68` | *"Two concrete implementations, separated by atomic operation"*, `TypeOrmUnitOfWorkImpl` satisface 3 puertos vía `useExisting`, *"A single financial impl because…"* | cuatro impls; el párrafo del *"single financial impl"* debe **invertirse**: el impl multi-agregado sigue en transactions, pero ya no presta servicio a los vecinos |
| B2-22 | `docs/concurrency-model.md:77-83` | mapa de locks | añadir columna de módulo dueño; **la semántica no cambia** |
| B2-23 | `docs/revision/PROJECT_GUIDE.md:94-97` | ciclo + patrón + ejemplos | reescribir |
| B2-24 | `docs/revision/PROJECT_GUIDE.md:130-132` | *"A single class … satisfies three module ports … via `useExisting`"* | reescribir |
| B2-25 | `src/shared/domain/uow-decision.md:11` | *"This port lives in the consumer module's domain ('port owned by consumer' pattern)"* | **colisión de terminología, ver §2.3** — acá la frase significa otra cosa que en el ADR-0003 |
| B2-26 | `src/shared/domain/uow-decision.md:13-14` | *"Level 3 — Single implementation … A single class `TypeOrmUnitOfWorkImpl` that satisfies every UoW port"* | pasa a *"Nivel 3 — una implementación por módulo"* |
| B2-27 | `src/shared/domain/cache-decision.md:208-214, 232` | usa el bloque `useExisting` de las 4 líneas como **contraejemplo** para argumentar herencia-vs-composición | el argumento sigue siendo válido pero el ejemplo deja de existir; hay que re-anclarlo al nuevo cableado sin romper la tesis del documento |
| B2-28 | `docs/adr/0003-*.md` + `docs/adr/README.md:13` | ver §2 | supersede + ADR nuevo |

`src/modules/accounts/notes.md:82-84, 105` y `docs/concurrency-model.md:323` caen en el alcance del
agente de accounts; se listan aquí sólo para que el barrido esté completo.

### No cambian (verificado, para que nadie los "arregle")

| Ubicación | Por qué sigue siendo cierta |
| --- | --- |
| `docs/adr/0002-unit-of-work-pessimistic-locks.md` **completo** | UoW request-scoped + `FOR UPDATE` en los scoped repos + agregados sin lock serializados por la fila-guardián: todo intacto. El refactor cambia *quién construye* los scoped, no *qué hacen* |
| `docs/adr/0001-ports-as-abstract-classes.md:19` | menciona `useExisting` *"for the shared UoW"* — sigue existiendo dentro de cada módulo (`{ provide: IBudgetUnitOfWork, useExisting: BudgetUnitOfWorkImpl }`). Sólo deja de ser **cruzado entre módulos**. Redacción actual sigue siendo válida |
| `docs/testing.md:34` | cita `IExpenseChecker` como ejemplo de puerto con estado que se testea con InMemory fake. El puerto sigue existiendo, sólo se mudó la impl. **Cierto antes y después** |
| `docs/concurrency-model.md:45-52` | *"scoped repos run on the QueryRunner's manager and not on the global DataSource (autocommit)"* — es exactamente lo que la factory acotada refuerza. Se puede **fortalecer** con una nota, pero no es falso |
| `docs/concurrency-model.md:355-370` (§13.1 "Implicit locks") | describe la grieta de los locks implícitos y propone `findByIdForUpdate()` en un puerto scoped. Sigue vigente; la factory **reduce** la grieta pero no la cierra. Vale añadir una nota, no reescribir |

---

## 2. El ADR-0003

### 2.1 Hallazgo que cambia el análisis: no queda **ningún** ejemplo vivo

Se buscó explícitamente si el patrón sobrevive con otro ejemplo. Método: enumerar los 26
`export abstract class` de `src/` y cruzarlos con sus implementaciones (`class X extends/implements I…`,
excluyendo `__fakes__` y `.spec.ts`).

Relaciones **puerto en módulo A ↔ impl en módulo B** que existen hoy:

| Puerto | Declarado en | Implementado en | Tras el refactor |
| --- | --- | --- | --- |
| `IExpenseChecker` | `budgets/domain/repository/expense-checker.port.ts:4` | `transactions` (`unit-of-work.impl.ts:188`) | → `budgets/infrastructure` · **mismo módulo** |
| `IBudgetRepository` | `budgets/domain/repository/budgets.repository.ts:10` | `transactions` (`unit-of-work.impl.ts:134`) | → `budgets/infrastructure` · **mismo módulo** |
| `IAccountRepository` | `accounts/domain/repository/accounts.repository.ts:3` | `transactions` (`unit-of-work.impl.ts:97`) | → `accounts/infrastructure` · **mismo módulo** |
| `IBudgetUnitOfWork` | `budgets/domain/IBudgetUnitOfWork.ts:5` | `transactions` (`unit-of-work.impl.ts:257`) | → `BudgetUnitOfWorkImpl` · **mismo módulo** |
| `IAccountUnitOfWork` | `accounts/domain/IAccountUnitOfWork.ts:4` | `transactions` (`unit-of-work.impl.ts:257`) | → `AccountUnitOfWorkImpl` · **mismo módulo** |

Todo lo demás es intra-módulo (`IPasswordHasher`→`BcryptPasswordHasher`, `IBudgetsCache`→`BudgetsCacheImpl`,
`IReportsReadStore`→`ReportsReadStoreImpl`, etc.) o `shared`→módulo (`IUnitOfWork`, `ICacheStore`), que es
DIP normal, no inversión para romper un ciclo.

**Conclusión: tras budgets + accounts, quedan cero instancias del patrón.** El ADR-0003 no pierde su
*ejemplo*; pierde su *objeto*. Y `reports` ya había demostrado el camino alternativo: resuelve la
misma necesidad (leer datos de transactions) a nivel de **schema** (la vista `v_period_expenses`),
con cero acoplamiento de compilación (`reports.module.ts:11-14`).

### 2.2 Decisión: **supersede**, no parche y no borrado — pero con una salvedad

**Supersede.** `docs/adr/0003-port-owned-by-consumer.md` pasa a `Status: Superseded by ADR-0009`, y se
crea `docs/adr/0009-module-owned-transactional-boundaries.md`.

Por qué **no un parche** al 0003: cambiar el ejemplo dejaría un ADR cuya `Decision` (`:21-23`,
*"the port is defined in A's domain and the implementation lives in B's infrastructure"*) describe una
práctica que el código ya no ejecuta en ningún lado. Un ADR no es documentación de referencia: es el
registro de una decisión. Editarlo para que "quede bien" borra el hecho de que la decisión existió y
fue revertida — que es justamente lo que un lector futuro necesita saber.

Por qué **no borrarlo**: el patrón fue real y estructuró el código durante meses (`5d722d4 fix: close
Race 1 & Race 2 via extended UoW pattern`). Borrarlo elimina la única explicación de por qué el repo
tuvo `forwardRef()` cruzados, y garantiza que alguien reintroduzca la inversión creyéndola nueva.

**La salvedad honesta:** superseder supone un ADR que registró una decisión. El 0003 está en
`Status: Draft` (`:3`), y `docs/adr/README.md:20-21` define Draft como *"the **what** is filled in from
the code; the **why** / alternatives are pending the author's input"*. Sus secciones `Why this option`
(`:27-31`) y `Alternatives considered` (`:35-37`) son comentarios HTML vacíos. Es decir: **el 0003
nunca registró un porqué; describía el código.** Se está superseding una descripción, no una decisión.

Eso obliga a que el ADR-0009 sea explícito al respecto en vez de fingir que revierte un razonamiento
que nunca se escribió. Redacción propuesta para el encabezado del 0003:

```markdown
- **Status:** Superseded by [ADR-0009](./0009-module-owned-transactional-boundaries.md)
- **Date:** 2026-05 (reverse-engineered from the code; never completed past Draft)
- **Superseded:** 2026-08-01

> **Superseded.** This ADR was written by reading the code, not by recording a decision:
> its "Why this option" and "Alternatives considered" were never filled in (see the Draft
> convention in [README](./README.md)). The pattern it describes was real — it is why the
> repo had crossed `forwardRef()`s — but the P1/P2 refactor removed its **last instance**:
> after it, no port in this codebase is declared in one module and implemented in another.
> Kept for the historical record. Do not use it as guidance. See ADR-0009.
```

### 2.3 Colisión de terminología a resolver en el mismo cambio

La frase *"port owned by consumer"* se usa hoy con **dos significados distintos**, y sólo uno muere:

| Significado | Dónde | Qué dice | ¿Sobrevive? |
| --- | --- | --- | --- |
| **(1) Inversión para romper un ciclo** — puerto en A, impl en B, con `forwardRef` | ADR-0003, `CLAUDE.md:98-105`, `architecture.md:76,152`, `PROJECT_GUIDE.md:95`, `budgets/notes.md:113-125` | `IExpenseChecker` en budgets, impl en transactions | **No.** Cero instancias tras el refactor |
| **(2) El puerto de UoW vive con el use case que lo consume** — aunque devuelva repos de otros módulos | `uow-decision.md:11` | `ITransactionUnitOfWork` vive en `transactions/domain` y devuelve `IAccountRepository`/`IBudgetRepository` (`ITransactionUnitOfWork.ts:20-21`) | **Sí, y se refuerza.** No hay inversión: `transactions → budgets` es directa en compilación y en runtime |

`uow-decision.md:11` es el único lugar con el significado (2). No hay que borrarlo — hay que **dejar de
llamarlo con el mismo nombre**, porque tras el refactor sólo queda ese sentido y el nombre arrastra la
connotación de inversión. Propuesta: renombrar el concepto (2) a **"UoW port owned by its consumer"** o
directamente describirlo sin etiqueta, y reservar la etiqueta vieja para el ADR-0003 superseded.

### 2.4 ADR-0009 — esqueleto (respeta `docs/adr/0000-template.md`)

```markdown
# ADR-0009: Each module owns its transactional boundary; scoped resources travel via guarded factories

- **Status:** Accepted
- **Date:** 2026-08-01
- **Deciders:** Vicente Cristobal Rivas Avello
- **Supersedes:** ADR-0003

## Context and problem statement
[El ciclo era artefacto de composición, no de dominio (PROBLEMS.md §"Marco previo" 42-64).
`Scope.REQUEST` ya implica una instancia por request, así que lo que serializa entre requests
es el row lock, nunca la instancia compartida de UoW. Ningún use case inyecta dos puertos de UoW.]

## Decision
Cada módulo implementa el UoW de su propio puerto. Cuando `transactions` necesita un recurso
escopado de un vecino, el módulo dueño exporta `createScopedX(queryRunner, deps): IX` — nunca
la clase ni un constructor que acepte `EntityManager`.

## Why this option
[EL PUNTO IMPORTANTE — el razonamiento existe y está en PLAN-P1P2-budgets.md §2 y §3:
la factory toma `QueryRunner` en vez de `EntityManager`, así que `dataSource.manager` deja de
COMPILAR; la verificación pasa de runtime a tiempo de compilación. Más `isTransactionActive`
(`node_modules/typeorm/query-runner/QueryRunner.d.ts:42`) como red de runtime.]

## Alternatives considered
- **Publicar la clase scoped cruda:** el constructor acepta `EntityManager`, y todo `EntityManager`
  lo satisface — incluido `dataSource.manager` en autocommit. Falla silenciosa.
- **Copia privada en transactions:** dos fuentes de verdad para el mutex del invariante; ningún
  test puede detectar la divergencia.
- **UoW a un módulo de persistencia neutral:** institucionaliza una afirmación falsa
  (PROBLEMS.md:371-378).
- **`AsyncLocalStorage`:** vuelve implícito el mecanismo más delicado del sistema (PROBLEMS.md:365-369).

## Consequences
**Positive** — grafo de módulos acíclico; la política de lock vive en el módulo dueño del agregado;
la garantía "sólo dentro de un QueryRunner activo" pasa de convención a tipo.
**Negative** — un archivo y una factory más por agregado compartido; y el riesgo nuevo de §3.
**Follow-ups** — P5 (puertos de comando acotados) encaja en el tipo de retorno de la factory.
```

**Nota de calidad:** el 0009 sería el **segundo ADR `Accepted`** del repo (hoy sólo el 0008,
`docs/adr/README.md:18`) y el primero cuyo *why* se escribe **en el momento de decidir** en vez de
reconstruirse leyendo el código. Vale la pena decirlo en la tabla del README de ADRs.

---

## 3. El anti-patrón nuevo para `CLAUDE.md`

### 3.1 Redacción propuesta

Va al final de la lista de `CLAUDE.md` (sección *"Anti-patterns — do not do"*, `:352-364`), en el
estilo exacto de las entradas existentes (`- **Do not** …`, imperativo, con el porqué en la misma frase):

```markdown
- **Do not** inject two UoW ports into the same use case. Each module now provides its own
  implementation, so two ports mean two `QueryRunner`s, two connections and two independent DB
  transactions inside one request. They cannot see each other's uncommitted writes, they burn two
  of `DB_POOL_MAX` slots, and if one waits on a row the other has locked, the request **deadlocks
  against itself** until the lock timeout — the second transaction can never commit, because the
  first is blocked on the same `await` chain. Before the split, `useExisting` made this
  structurally impossible; now only this rule prevents it. If a flow genuinely needs two
  aggregates atomically, it belongs in the module that owns the multi-aggregate boundary
  (`transactions`), which composes the neighbours' scoped resources onto its own `QueryRunner`
  via `createScopedX(queryRunner, …)`.
```

### 3.2 Dependencia con el plan de P3+P4 — mi lectura, para no asumir el resultado

El coordinador señala que el agente de P3+P4 evalúa si el runner sin estado (`run(work => …)`)
vuelve este riesgo imposible por construcción. **Mi análisis previo dice que por sí solo no lo hace**,
y lo dejo escrito para que ese agente lo confirme o lo refute en vez de que ambos asumamos:

- El runner elimina el *ciclo de vida manual* (P4) y el `Scope.REQUEST` (P3). No elimina que un use
  case pueda inyectar dos runners y anidar `budgetUow.run(async () => { await txUow.run(…) })`. Eso
  sigue abriendo **dos** transacciones y sigue pudiendo auto-bloquearse.
- Lo que sí lo haría imposible es que el runner **detecte una transacción ya activa para el mismo
  request** y o bien se una a ella, o bien lance. Eso requiere contexto ambiental
  (`AsyncLocalStorage`), que `PROBLEMS.md:365-369` descarta explícitamente para este proyecto por
  volver implícito el mecanismo más delicado del sistema.
- La guarda de reentrada que `PROBLEMS.md:246` propone (`if (this.isActive()) throw` al inicio de
  `begin()`) cubre el caso **doble `begin()` sobre la misma instancia**, no el caso **dos instancias
  distintas**. Son riesgos diferentes; conviene no confundirlos al redactar.

**Cómo dejarlo:** escribir la entrada tal cual en §3.1, y añadir al final del `.md` de este plan una
marca `<!-- PENDIENTE: confirmar con el plan de P3+P4 -->`. Si ese plan demuestra que el runner sí lo
cierra por construcción, la entrada cambia de naturaleza: deja de ser un anti-patrón (regla de
proceso, sostenida por code review) y pasa a ser una **nota de diseño** ("el runner rechaza la
reentrada; ver ADR-00XX"). No hay que escribirla dos veces: hay que escribirla una vez y revisarla
cuando ese plan cierre.

---

## 4. Adición a `src/PROBLEMS.md`

El riesgo no existía cuando se escribió el inventario, porque lo **introduce P1**. No es un problema
del código actual: es una regresión latente que P1 habilita. Por eso no va como P8 (rompería la
premisa del documento: *"cada problema tiene enunciado, evidencia en código, costo real"* — este no
tiene evidencia en código, tiene evidencia en el diseño futuro).

**Ubicación propuesta:** dentro de P1, justo después de *"Prueba de que funcionó"* (`PROBLEMS.md:130-131`).

```markdown
**Riesgo de regresión que P1 introduce (no existía antes):** hoy `useExisting`
(`transactions.module.ts:63-74`) hace **estructuralmente imposible** que un request abra dos
transacciones: los tres tokens resuelven a la misma instancia. Tras P1 son cuatro impls
independientes, y un use case que inyecte dos puertos de UoW abriría dos `QueryRunner`s, dos
conexiones y dos transacciones que no se ven entre sí. Si una espera una fila que la otra tiene
bloqueada, la request **se auto-bloquea** hasta el timeout: la segunda transacción no puede
commitear porque la primera está detenida en la misma cadena de `await`.

Hoy ningún use case lo hace — verificado sobre los 8 use cases transaccionales, cada uno inyecta
exactamente un puerto (`create-transaction:30`, `delete-transaction:14`, `delete-budget:13`,
`update-budget-limit:21`, `archive-account:14`, `unarchive-account:14`, `rename-account:15`,
`refresh-token:20`). El riesgo pasa de "imposible" a "posible si alguien lo escribe", y no hay
nada que lo detecte: compila, y sólo falla bajo la combinación exacta de filas en conflicto.

Mitigación: anti-patrón explícito en CLAUDE.md + criterio de code review. **No** lo cierra la
guarda de reentrada (`if (this.isActive()) throw`) propuesta en P4: esa cubre el doble `begin()`
sobre la *misma* instancia, no dos instancias distintas. Ver si P3+P4 puede cerrarlo por
construcción.
```

Y en la tabla resumen (`PROBLEMS.md:394-402`), la fila de P1 dice hoy `Riesgo: bajo`. **Mantenerlo en
"bajo"** —nada lo dispara hoy y el trabajo en sí es de bajo riesgo— pero marcarlo:

```markdown
| **P1** Binding cruzado de tokens | sí, ambas aristas | medio | bajo ⚠️ | estructural |
```
con nota al pie: `⚠️ introduce un riesgo de regresión latente; ver el bloque al final de P1.`

---

## 5. Reescritura de las tablas de `CLAUDE.md`

### 5.1 Tabla de puertos e implementaciones (reemplaza `:126-140`)

```markdown
### The model

The system has **four** UoW implementations, one per bounded context. Each module owns both the
port and the implementation; no module provides a transactional token for another.

| Port                     | Owner                 | Used by                                  | Implemented by                                  |
| ------------------------ | --------------------- | ---------------------------------------- | ----------------------------------------------- |
| `IUnitOfWork`            | `shared/domain`       | (base — lifecycle only)                  | all four impls                                  |
| `ITransactionUnitOfWork` | `transactions/domain` | `CreateTransaction`, `DeleteTransaction` | `TypeOrmUnitOfWorkImpl` (`transactions/infra`)  |
| `IBudgetUnitOfWork`      | `budgets/domain`      | `UpdateBudgetLimit`, `DeleteBudget`      | `BudgetUnitOfWorkImpl` (`budgets/infra`)        |
| `IAccountUnitOfWork`     | `accounts/domain`     | `Archive`, `Unarchive`, `Rename`         | `AccountUnitOfWorkImpl` (`accounts/infra`)      |
| `IAuthUnitOfWork`        | `auth/domain`         | `RefreshToken`                           | `AuthUnitOfWorkImpl` (`auth/infra`)             |

Each is wired inside its own module with the same two lines:

​```ts
{ provide: XUnitOfWorkImpl, useClass: XUnitOfWorkImpl, scope: Scope.REQUEST }
{ provide: IXUnitOfWork,    useExisting: XUnitOfWorkImpl }
​```

`useExisting` still exists, but only **within** a module — never to hand a transactional token to
a neighbour. That cross-module aliasing is what created the two `forwardRef()` cycles; it bought
no concurrency guarantee, because no use case ever injected two UoW ports (and none may — see
anti-patterns).

`TypeOrmUnitOfWorkImpl` remains the **only multi-aggregate** boundary: `CreateTransaction` needs
transaction + account + budget rows in one PG transaction. It obtains the neighbours' scoped
resources through their factories (below), on its own `QueryRunner`.
```

Esto también sustituye la sección *"Why the impl lives in `transactions/`"* (`:142-148`): el argumento
sobrevive pero cambia de conclusión — transactions sigue siendo dueño del **impl multi-agregado**, ya
no del impl de los vecinos.

### 5.2 Recursos escopados y mapa de locking (reemplaza `:150-180`)

La clave de esta reescritura: **la columna de semántica de lock no cambia ni una palabra.** El
refactor mueve *dónde vive* el código, nunca *qué hace*. Conviene que la tabla lo haga evidente
añadiendo la columna de ubicación, para que un futuro diff que altere la columna de la derecha salte
a la vista.

```markdown
### Scoped resources

Every scoped class is **private to its file**. The only door is a factory that takes a
`QueryRunner` (not an `EntityManager`) and refuses to build outside an active transaction — see
ADR-0009.

| Scoped class                    | Lives in                                        | Door                                    | Consumed by                                        |
| ------------------------------- | ----------------------------------------------- | --------------------------------------- | -------------------------------------------------- |
| `ScopedTransactionRepository`   | `transactions/infra` (`unit-of-work.impl.ts`)   | `getScopedTransactionRepository()`      | `TypeOrmUnitOfWorkImpl`                            |
| `ScopedAccountRepository`       | `accounts/infra` (`scoped-account.repository.ts`)  | `createScopedAccountRepository(qr, m)`  | `AccountUnitOfWorkImpl`, `TypeOrmUnitOfWorkImpl`   |
| `ScopedBudgetRepository`        | `budgets/infra` (`scoped-budget.repository.ts`) | `createScopedBudgetRepository(qr, m)`   | `BudgetUnitOfWorkImpl`, `TypeOrmUnitOfWorkImpl`    |
| `ScopedExpenseChecker`          | `budgets/infra` (`scoped-expense-checker.ts`)   | `createScopedExpenseChecker(qr)`        | `BudgetUnitOfWorkImpl`, `TypeOrmUnitOfWorkImpl`¹   |
| `ScopedRefreshTokenRepository`  | `auth/infra` (`auth-unit-of-work.impl.ts`)      | `getRefreshTokenRepository()`           | `AuthUnitOfWorkImpl`                               |

¹ tras P6, `CreateTransaction` consume el checker de budgets en vez de su propia copia de la query.

### Locking & serialization map

**Unchanged by the P1/P2 refactor.** The classes moved modules; not one lock mode, ordering or
serialization argument changed. The "Lives in" column exists so that a future diff touching the
right-hand column is visible.
```

…y a continuación la tabla de locks actual (`:167-179`) con una columna `Lives in` añadida y **el
texto de la columna "Purpose" copiado literal**. Las cuatro filas de agregados (`sum…`,
`hasExpensesInPeriod`, `sumExpenseAmountInPeriod`) mantienen su *"No own lock (aggregate)"* y su
explicación palabra por palabra; tras P6 se colapsan las dos primeras en una.

### 5.3 La sección §5 de "Patterns that don't change" (reemplaza `:98-105`)

```markdown
### 5. Module-owned transactional boundaries + guarded factories

Every module owns its UoW port **and** its implementation. When a module needs a neighbour's
scoped resource inside its own transaction, the owning module exports a factory —
`createScopedBudgetRepository(queryRunner, mapper)` — never the class.

The factory takes a `QueryRunner`, not an `EntityManager`. That is not cosmetic: every
`EntityManager` satisfies `EntityManager`, including `dataSource.manager` in autocommit, where a
`FOR UPDATE` is released the moment the SELECT returns and the invariant silently loses its
serialization gate. With a `QueryRunner` parameter that call no longer **compiles**, and the
factory additionally asserts `queryRunner.isTransactionActive` at runtime.

This replaces the old "port owned by consumer" pattern (ADR-0003, superseded), which inverted
ports to break module cycles. There are no cycles left to break: after the P1/P2 refactor no port
in this codebase is declared in one module and implemented in another. See ADR-0009.
```

---

## 6. Qué NO tocar — histórico

**Regla:** un documento fechado que narra un cambio pasado registra el estado del mundo **en ese
momento**. Corregirlo para que coincida con el código de hoy destruye el registro y hace imposible
reconstruir por qué el sistema evolucionó como evolucionó.

**Evidencia concreta de por qué la regla importa, verificada con git:**
`docs/history/race-conditions-fix-2026-05.md:210` afirma que `ScopedExpenseChecker.hasExpensesInPeriod`
usa `pessimistic_write`. Eso es **falso hoy** (`unit-of-work.impl.ts:208-211` documenta explícitamente
lo contrario: Postgres prohíbe locks pesimistas sobre agregados). Pero era **cierto cuando se
escribió**: `git log -S "pessimistic_write"` muestra `5d722d4 fix: close Race 1 & Race 2 via extended
UoW pattern` (que lo introdujo) y, después, `bcb569b fix(budgets): drop FOR UPDATE from aggregate
expense queries` (que lo quitó, al descubrirse que era un bug). Ese documento es el único lugar donde
consta que el equipo **primero** creyó que el lock sobre el agregado servía. "Corregirlo" borraría
exactamente el aprendizaje.

**Lista de exclusión explícita:**

| Archivo | Contiene | Estado |
| --- | --- | --- |
| `docs/history/race-conditions-fix-2026-05.md` | `:50, 87, 113-122, 147-220` — todo el cableado `useExisting`, `forwardRef`, `getAccountRepository()`, el lock sobre agregados | **congelado** |
| `docs/history/hardening-audit-2026-04.md` | auditoría fechada | **congelado** |
| `docs/history/production-readiness-2026-06-16.md` | checklist fechado | **congelado** |
| `src/modules/budgets/notes-history.md` | `:19, 27` — Bug A y Race 1 desde el lado de budgets | **congelado** |
| `src/modules/transactions/notes-history.md` | `:18-23, 58-60` — Bug A, Bug A.2, Bug B | **congelado** |
| `docs/blog/how-i-closed-6-race-conditions.md`, `docs/blog/linkedin-post-es.md` | narrativa publicada | **congelado** (además: el barrido no encontró en ellos ninguna de las cadenas afectadas) |

**Única acción permitida sobre ellos:** si se quiere evitar que un lector los tome por vigentes, añadir
una línea de banner **al principio**, sin tocar el cuerpo:

```markdown
> **Histórico.** Describe el estado del sistema en <fecha>. Partes ya no reflejan el código actual
> (el UoW se partió por módulo en el refactor P1/P2, 2026-08). Ver CLAUDE.md y ADR-0009 para el
> modelo vigente. **No actualizar este archivo:** su valor es registrar lo que se creía entonces.
```

`src/PLAN-P1P2-budgets.md` y el plan hermano de accounts también quedan congelados una vez aplicados:
son planes fechados, no documentación de referencia.

---

## 7. Agrupación en commits

El criterio: **una doc se actualiza cuando puede quedar verdadera, no antes.** Actualizar un
documento compartido con budgets-solo lo deja falso para accounts y garantiza conflicto con el PR
hermano.

| # | Commit | Contenido | Depende de | Por qué ahí |
| --- | --- | --- | --- | --- |
| **D0** | `docs: fix pre-existing drift in UoW getter names and port ownership` | Grupo A completo (A1-A9) | **nada** | Ya son falsas hoy. Landea **antes** de todo, reduce el ruido de los diffs de los PRs de refactor y evita que se confunda deuda vieja con consecuencia del refactor |
| **D1** | *(dentro del PR de budgets)* | B1-3, B1-5, B1-6, B1-7, B1-8, B1-9 (tablas de `CLAUDE.md`) + B1-10 (`budgets/notes.md`) + B1-11 parcial (`transactions/notes.md`) + §4 (`PROBLEMS.md`) + §3.1 (anti-patrón) | commits 1-3 del plan de budgets | Regla de `CLAUDE.md:5`: la doc se arregla en el mismo cambio. Las **tablas** sí admiten actualización parcial exacta: se escribe `BudgetUnitOfWorkImpl` en la fila de budgets y se deja `TypeOrmUnitOfWorkImpl` en la de accounts. Queda verdadera, no a medias |
| **D2** | *(dentro del PR de budgets, commit de P6)* | B1-12, B1-13, B1-14, B1-15 | commit 4 (P6) | Se revierten junto con P6 si P6 se difiere |
| **D3** | *(dentro del PR de accounts)* | A8 si no entró en D0, las filas de accounts de las tablas, `accounts/notes.md:82-105`, `concurrency-model.md:323` | plan hermano | Simétrico a D1 |
| **D4** | `docs: retire the port-owned-by-consumer pattern (ADR-0003 → ADR-0009)` | §2 completa: supersede del 0003, ADR-0009 nuevo, `docs/adr/README.md:13,18` + fila nueva | **budgets Y accounts landeados** | El 0009 afirma *"no port is declared in one module and implemented in another"*. Con un solo módulo refactorizado esa frase es **falsa** |
| **D5** | `docs: rewrite the module graph and UoW narrative after the split` | B2-16 a B2-27: `architecture.md` §2/§2.1/§2.2, `README.md:94-106`, `concurrency-model.md:57-83`, `PROJECT_GUIDE.md:94-132`, `uow-decision.md`, `cache-decision.md`, `CLAUDE.md:66` y §5.3 | **budgets Y accounts** | Son diagramas y narrativa que describen los **dos** ciclos como una figura única. Reescribirlos dos veces = dos conflictos de merge y un estado intermedio falso |
| **D6** | `docs: mark historical notes as frozen` | banners de §6 | D5 | Opcional; sólo tiene sentido cuando el modelo nuevo ya está escrito para poder enlazarlo |

**Riesgo de coordinación a señalar:** D1 y D3 tocan **las mismas tablas de `CLAUDE.md`** (`:126-180`).
Aunque cada uno edita filas distintas, git verá el mismo hunk. Dos opciones, a elección del
coordinador:
1. **Secuencial** — budgets landea, accounts rebasea. Simple, y el conflicto es trivial (una fila).
2. **Diferir las tablas a D5** — los PRs de código no tocan `CLAUDE.md`, y D5 reescribe todo de una.
   Viola la letra de `CLAUDE.md:5` durante la ventana entre PRs. Aceptable **sólo** si esa ventana es
   corta y el PR de budgets deja una nota `> ⚠️ tablas desactualizadas hasta que landee accounts`.

Recomiendo la **opción 1**: mantiene la regla del repo y el costo real es un rebase de una fila.

---

## 8. Verificación

**Automatizable (barato, y vale la pena dejarlo como check de CI o pre-commit):**

```bash
# 1. Ningún .md vigente debe seguir nombrando la impl retirada para budgets/accounts.
grep -rn "TypeOrmUnitOfWorkImpl" --include=*.md . \
  | grep -v node_modules | grep -v "docs/history/" | grep -v "notes-history.md" \
  | grep -v "docs/blog/" | grep -v "src/PLAN-"
# Esperado tras D5: sólo menciones donde TypeOrmUnitOfWorkImpl sigue siendo correcto
# (el impl multi-agregado de transactions).

# 2. El patrón retirado no debe quedar como guía vigente.
grep -rn "port owned by consumer\|port-owned-by-consumer" --include=*.md . \
  | grep -v node_modules | grep -v "docs/history/" | grep -v "docs/blog/"
# Esperado tras D4/D5: sólo el ADR-0003 (superseded) y el enlace desde el 0009.

# 3. Nombres de getters — Grupo A.
grep -rn "getAccountRepository()\|getBudgetRepository()" --include=*.md . \
  | grep -v node_modules | grep -v "docs/history/" | grep -v "notes-history.md"
# Esperado tras D0: vacío.

# 4. Archivos citados que no existen (lo que produjo A4).
#    Revisión manual de los enlaces relativos de docs/adr/*.md y de los notes.md.
```

**No automatizable, y hay que decirlo:** que el *contenido* de un párrafo reescrito sea correcto no lo
verifica ningún grep. Las secciones narrativas (D5) requieren lectura humana contra el código. El
único proxy razonable es que las afirmaciones nuevas lleven `archivo:línea`, como este plan, para que
un lector futuro pueda falsarlas sin reconstruir el razonamiento.

**Lo que no pude verificar:**
- Si `docs/history/race-conditions-fix-2026-05.md` era exacto en **todos** sus puntos al escribirse.
  Verifiqué el caso del lock sobre agregados (`:210`) vía `git log -S`; los demás los asumo por la
  misma lógica, sin comprobarlos uno a uno.
- Si `docs/revision/PROJECT_GUIDE.md` y `docs/revision/*.svg|png` son documentación viva o un artefacto
  de una revisión puntual. El nombre del directorio (`revision/`) sugiere lo segundo, lo que los
  movería al Grupo C. **Requiere confirmación del autor.** Mientras tanto los traté como vivos
  (B2-23, B2-24), que es la opción conservadora: corregir de más es recuperable, congelar de más no.
- Los diagramas `docs/revision/Layer Diagram.png`, `Modules diagram.png` y sus `.svg`: son binarios/vectoriales
  y **no puedo inspeccionar su contenido**. Si el diagrama de módulos dibuja los dos ciclos con
  `forwardRef`, queda falso y hay que regenerarlo. **Verificación manual pendiente.**

<!-- PENDIENTE: confirmar con el plan de P3+P4 si el runner sin estado cierra por construcción el
     riesgo de §3/§4. Mi análisis (§3.2) dice que no lo hace por sí solo. Si lo cierra, la entrada
     de anti-patrón §3.1 cambia de naturaleza (regla de proceso → nota de diseño). -->
