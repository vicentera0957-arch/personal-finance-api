# Plan: P3 + P4 — El UoW como *runner* sin estado

> **Objetivo:** convertir los 4 Unit of Work de máquinas de estado a funciones, cerrando de una sola cirugía la duplicación del ciclo de vida (P4) y el contagio de `Scope.REQUEST` (P3).
> **Estado:** 🟡 En progreso — Fases 1 y 2 completas (P4 cerrado), Fases 3 y 4 pendientes (P3 abierto).
> **Prioridad:** Alta
> **Última actualización:** 2026-08-03
> **Rama:** `refactor/p4-transactional-runner`
> **Versión larga:** `git show b64d580:src/PLAN-P3P4-transactional-runner.md` (1153 líneas — análisis completo del auto-deadlock, tabla de caminos de rollback de TypeORM, decisión de orden vs. P5).

---

## 1. Objetivo

### Resultado esperado

`IUnitOfWork` expone **un solo método**:

```ts
export abstract class IUnitOfWork<TCtx> {
  abstract run<T>(work: (ctx: TCtx) => Promise<T>): Promise<T>;
}
```

El `QueryRunner` vive en el stack de la llamada, no en un campo. De ahí salen las dos consecuencias:

- Sin campo mutable → los impls son **singleton** → nadie propaga `Scope.REQUEST` (**P3**).
- El `release()` está en un `finally` escrito **una vez** en una clase base → imposible de olvidar (**P4**).

### Criterios de éxito

- [x] Ningún use case llama `begin`/`commit`/`rollback`/`release` a mano (P4)
- [x] Las aserciones de los specs existentes pasan **sin reescribirse** — sólo cambian los constructores de dobles
- [x] La revocación de familia en replay detection sigue commiteando aunque la request termine en 401
- [ ] `grep -rn "Scope\." src` → 0 resultados (P3)
- [ ] `app.get(Controller)` no lanza para ninguno de los 7 controllers de dominio
- [ ] El ciclo de vida existe en **un** archivo, no en cuatro
- [ ] `concurrency.integration.spec.ts` pasa sin modificar (9 escenarios)

---

## 2. Contexto actual

### Estado

Los 4 impls (`TypeOrmUnitOfWorkImpl`, `BudgetUnitOfWorkImpl`, `AccountUnitOfWorkImpl`, `AuthUnitOfWorkImpl`) son independientes desde P1+P2 y guardan el `QueryRunner` en un campo mutable:

```ts
private queryRunner: QueryRunner | null = null;
```

### Problema

| | |
|---|---|
| **P3** | El campo mutable obliga a `Scope.REQUEST`. NestJS lo propaga transitivamente: UoW → use case → **controller**. 4 de los 7 controllers de dominio se reconstruyen en cada request. |
| **P4** | El bloque `begin/try/commit/catch/rollback/finally/release` está copiado en **8 use cases**. Los 8 son correctos hoy; el riesgo es el noveno: un `release()` olvidado filtra la conexión del pool hasta reiniciar el proceso. |

**27 renglones idénticos byte a byte, replicados 4 veces.** P7 lo demostró: su guard de `rollback()` hubo que escribirlo cuatro veces, porque no existe un lugar donde escribirlo una sola vez.

### Restricciones

- El runner **re-lanza el objeto de excepción original, sin envolver** — los controllers hacen `instanceof` para mapear a HTTP; envolver rompe todas las respuestas 4xx a la vez.
- Los cuerpos de los repos escopados y sus comentarios de lock **no se tocan**: sólo cambia quién construye el contexto y cuándo.
- El orden `lock → agregado` dentro de cada flujo queda idéntico.
- Postgres y Redis no están disponibles en el entorno de desarrollo actual → `test:integration` no corre.

### Decisiones existentes (no revisar)

- Los puertos de módulo siguen siendo `abstract class` — son tokens de DI.
- Los 4 impls siguen siendo 4: un módulo cuya frontera transaccional toca sólo su agregado es dueño de su UoW.
- **P5 (narrow ports) va DESPUÉS de este plan.** Los 7 llamadores que P5 modifica viven en los use cases que este plan reescribe enteros.
- P6 es indiferente: sólo decide si `TransactionTxContext` nace con 3 o 4 recursos.

---

## 3. Plan

### Fase 1 — Base compartida ✅

**Objetivo:** que exista el runner y el detector, sin que nadie los use.

- [x] **1.1** Clase base con el ciclo de vida escrito una vez
  - Archivo: `src/shared/infrastructure/persistence/typeorm-transaction-runner.ts`
  - Resultado: `run()` con `commit` al salir limpio, `rollback` en `catch` (envuelto en su propio `try` para no enmascarar el error original), `release` en `finally`, y el `Proxy` que invalida `ctx` al salir
- [x] **1.2** Detector de anidamiento
  - Archivos: `active-transaction.storage.ts`, `nested-transaction.error.ts`
  - Resultado: `AsyncLocalStorage` que lleva **sólo** `{ owner: string }` y cuyo único efecto es lanzar
- [x] **1.3** Tests del runner (8 casos)
  - Archivo: `typeorm-transaction-runner.spec.ts`

**Verificación**
- [x] `npm test` verde con los 8 tests nuevos
- [x] Nadie importa el runner desde producción

---

- [x] **1.4** `run()` conviviendo con el ciclo viejo *(commit 2)*
  - Archivos: `src/shared/domain/IUnitOfWork.ts`, los 4 puertos de módulo, los 4 impls, los 2 fakes
  - Resultado: `IUnitOfWork<TCtx>` gana `run()` **sin perder** los 5 métodos. Cada impl lo implementa reusando su propio `begin/commit/rollback/release`. Comportamiento idéntico.

Los 4 contextos:

```ts
interface TransactionTxContext { transactions; accounts; budgets; }  // 3
interface BudgetTxContext      { budgets; expenses; }                // 2
interface AccountTxContext     { accounts; }                         // 1
interface AuthTxContext        { refreshTokens; }                    // 1
```

**Verificación**
- [x] Suite completa verde, cero cambios de comportamiento

---

### Fase 2 — Migrar los 8 use cases ✅

**Objetivo:** cerrar P4 sin tocar el grafo de DI.

- [x] **2.1** accounts — `archive`, `unarchive`, `rename` *(commit 3)*
- [x] **2.2** budgets — `delete-budget`, `update-budget-limit` *(commit 4)*
  - La invalidación de caché queda **después** de `run()`, sin el `try` anidado que exigía P7
- [x] **2.3** transactions — `create`, `delete` *(commit 5)*
  - La traducción `InsufficientFunds → CannotDelete` sale del `run()` y va en un `catch` afuera
- [x] **2.4** auth — replay detection como desenlace commiteado *(commit 6)*
  - El caso replay **retorna** `{ kind: 'replay' }` (salida normal ⇒ el runner commitea) y la excepción se lanza afuera. El flag `committed` desaparece.

**Verificación**
- [x] 633 tests verdes (625 baseline + 8 nuevos)
- [x] El spec de auth **no cambió ni una línea** (commit 6 tocó un solo archivo)
- [ ] `concurrency.integration.spec.ts:490` — pendiente, requiere Postgres

> 🔒 **Punto de rollback.** Acá P4 está cerrado y el grafo de DI está intacto. Estado coherente y valioso por sí solo.

---

### Fase 3 — Eliminar el ciclo manual y `Scope.REQUEST` ⬜

**Objetivo:** cerrar P3. **Es el único commit con riesgo de boot de Nest.**

- [ ] **3.1** Borrar `begin`/`commit`/`rollback`/`release`/`isConnected` del puerto, los 4 impls y los 2 fakes
- [ ] **3.2** Los 4 impls pasan a `extends TypeOrmTransactionRunner<TCtx>` + `implements ISuPuerto`
  - Cada uno queda en ~12 líneas: constructor + `createContext(qr)`
  - Los getters mueren; sus cuerpos se mudan tal cual a `createContext()`
- [ ] **3.3** Atar el cabo suelto: `TypeOrmTransactionRunner` debe `extends IUnitOfWork<TCtx>` (hoy no lo hace — no podía en la Fase 1, porque el puerto aún no era genérico)
- [ ] **3.4** Quitar los 8 `Scope.REQUEST` y colapsar los 3 pares `useExisting` a `useClass`
  - `accounts.module.ts` ya tiene la forma final: sólo borrar el `scope`
- [ ] **3.5** Reemplazar `rollback-guard.integration.spec.ts` por su equivalente sobre `run()`
  - **Se reemplaza, no se adapta**: el contrato que prueba deja de tener superficie pública. Borrarlo sin reemplazo sería perder cobertura.
- [ ] **3.6** Crear `test/integration/di-scope.integration.spec.ts`

**Verificación**
- [ ] `grep -rn "Scope\." src` → 0
- [ ] `app.get(C)` no lanza para los 7 controllers, y `app.get(X) === app.get(X)`
- [ ] Suite completa + integración

---

### Fase 4 — Documentación ⬜

**Objetivo:** que el repo no mienta sobre su propio modelo de concurrencia.

- [ ] **4.1** `CLAUDE.md` §Concurrency (snippet `useExisting`, tabla de puertos, "Scoped resources" → propiedades del contexto)
- [ ] **4.2** `CLAUDE.md` §Anti-patterns: + "un use case inyecta como máximo un puerto de UoW"; + "el store de `activeTransaction` nunca lleva recursos"; **reformular** el anti-patrón de P7 (bajo el runner ese lugar no existe: pasa de "no lo hagas" a "no podés hacerlo")
- [ ] **4.3** `PROBLEMS.md`: marcar P3 y P4 resueltos, actualizar tabla y mapa, cerrar la discrepancia de orden con P5
- [ ] **4.4** `uow-decision.md`, `cache-decision.md:139`, `notes.md` de transactions/accounts/budgets
- [ ] **4.5** `docs/architecture.md`, `docs/concurrency-model.md`

---

## 4. Archivos afectados

| Archivo | Cambio | Fase |
|---|---|---|
| `shared/infrastructure/persistence/typeorm-transaction-runner.ts` | **nuevo** — la clase base | 1 ✅ |
| `shared/infrastructure/persistence/active-transaction.storage.ts` | **nuevo** — el ALS detector | 1 ✅ |
| `shared/infrastructure/persistence/nested-transaction.error.ts` | **nuevo** | 1 ✅ |
| `shared/infrastructure/persistence/typeorm-transaction-runner.spec.ts` | **nuevo** — 8 casos | 1 ✅ |
| `shared/domain/IUnitOfWork.ts` | 5 métodos + `run<T>` → sólo `run<T>`; genérico en `TCtx` | 1 ✅ / 3 |
| Los 4 puertos de módulo | + su `XTxContext`; el cuerpo queda vacío | 1 ✅ / 3 |
| Los 4 impls | `run()` transitorio → `extends TypeOrmTransactionRunner` + `createContext()` | 1 ✅ / 3 |
| Los 8 use cases | el bloque manual → `uow.run(async (ctx) => …)` | 2 ✅ |
| Los 8 specs | sólo los constructores de dobles | 2 ✅ |
| Los 2 fakes in-memory | contadores adentro de `run()`; **getters perezosos** en el contexto | 1 ✅ / 3 |
| Los 4 `*.module.ts` | quitar `Scope.REQUEST`; colapsar `useExisting` → `useClass` | 3 |
| `test/integration/concurrency/rollback-guard.integration.spec.ts` | **se reemplaza** | 3 |
| `test/integration/di-scope.integration.spec.ts` | **nuevo** | 3 |

---

## 5. Decisiones de diseño

### D1 — El `QueryRunner` vive en el stack, no en un campo

**Razón:** es la causa raíz común de P3 y P4. Sin campo mutable no hay razón para `Scope.REQUEST`, y sin ciclo de vida público no hay `release()` que olvidar.

---

### D2 — `TCtx` es `interface`, no `abstract class`

**Razón:** la regla de CLAUDE.md ("los puertos son `abstract class`") existe porque un `interface` no puede ser token de DI. `TransactionTxContext` **nunca se inyecta**: es el tipo de un parámetro de callback. Precedente en el repo: `CreateTransactionCommand`, `UpdateBudgetLimitCommand`, `ArchiveAccountDto`.

**El puerto de módulo sigue siendo `abstract class`.** Esa regla no cambia.

---

### D3 — Replay detection: desenlace retornado, no excepción

**Decisión:** el caso replay hace `revokeFamily()` y **retorna** `{ kind: 'replay' }`. La excepción se lanza fuera del `run()`.

**Razón:** la revocación de familia debe persistir aunque la request termine en 401. Si el callback lanza, el runner hace rollback y **deshace la revocación** — regresión de seguridad silenciosa. Además es más honesto que el flag `committed`: el código pasa de "commiteo y lanzo igual" a "revocar la familia **es** un desenlace exitoso; el 401 es una decisión posterior".

**Alternativas descartadas:**
- **Sentinel `CommitAndThrow(err)`** — mete un concepto nuevo en el contrato compartido para un único call site, y crea una segunda forma de lanzar.
- **`ctx.commitNow()`** — reintroduce ciclo de vida manual dentro del callback, que es exactamente lo que P4 elimina.

---

### D4 — `AsyncLocalStorage` como detector, **nunca** como propagador

**Decisión:** el store lleva un `string`. Nunca un `EntityManager`, `QueryRunner` ni repositorio.

**Razón:** un runner sin estado es reentrante por defecto, así que **el anidamiento pasa de ruidoso a silencioso** — y es peor que un deadlock normal: si TX_A tiene `FOR UPDATE` y TX_B pide la misma fila en la misma cadena de `await`, Postgres **no lo ve como deadlock** (no hay ciclo entre backends) y cuelga hasta el `lock_timeout`.

`PROBLEMS.md` rechaza el ALS **para propagar el contexto transaccional**, y con razón. Acá el contexto sigue viajando explícito por `ctx`; el ALS sólo agrega una comprobación. **Escribir esta distinción en CLAUDE.md** (Fase 4.2) — el próximo que lea `AsyncLocalStorage` en este repo va a buscar la contradicción.

**Limitación declarada:** no detecta `Promise.all([uowA.run(…), uowB.run(…)])`. Pero ahí sí hay ciclo entre backends y Postgres lo aborta con `40P01`.

---

### D5 — Fuga del `ctx`: no se previene por tipos

**Decisión:** `Proxy` que lanza si se toca `ctx` después del `run()`, + regla escrita en CLAUDE.md.

**Razón:** TypeScript no tiene lifetimes. La mitigación real es de TypeORM: tras `release()`, `query()` lanza `QueryRunnerAlreadyReleasedError` determinista — no hay escritura silenciosa en autocommit. **El `Proxy` mejora el mensaje de error; no es una barrera**, y sólo cubre la fuga del `ctx`, no la de una propiedad ya extraída.

---

### D6 — Secuencia de 8 commits con punto de rollback tras el 6

**Razón:** `IUnitOfWork` puede llevar `run()` y los 5 métodos viejos a la vez, así cada módulo se convierte por separado. El riesgo queda concentrado en un commit chico (el 7) y P4 —la mitad que paga sola— se cobra primero.

**Costo aceptado:** entre las Fases 2 y 3 el ciclo de vida está escrito **8 veces** en vez de 4 (cada impl tiene su `run()` transitorio envolviendo su propio ciclo). Es transitorio por diseño y muere entero en la Fase 3.

---

## 6. Tests y verificación

### Criterio maestro

> **Si hay que reescribir una aserción, el refactor se salió de "cambio de forma" a "cambio de comportamiento".** Sólo cambian los constructores de dobles.

### Tests existentes

- [x] 13 aserciones de los fakes in-memory (`commits()` / `rollbacks()`) — sobreviven verbatim
- [x] 24 aserciones de los 5 mocks literales — sobreviven verbatim
- [x] `refresh-token.use-case.spec.ts` — **cero cambios**, incluido `expect(uow.commits()).toBe(1)` en el caso replay
- [ ] `concurrency.integration.spec.ts` — 9 escenarios, sin modificar. El `:490` (dos `/auth/refresh` con el mismo token) es la red del cambio de mayor riesgo

### Tests nuevos

- [x] `typeorm-transaction-runner.spec.ts` — 8 casos. El de mayor valor: **"la excepción llega intacta"**, sin él un futuro `throw new Error('transaction failed: ' + …)` rompería los mapeos 400/403/404/409/422 sin que ningún otro test lo note
- [ ] `di-scope.integration.spec.ts` — `app.get(C)` sobre los 7 controllers. `isDependencyTreeStatic()` es falsa para cualquier provider contagiado **transitivamente**, así que es una sonda que un `grep` no puede replicar

### Verificación final

```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
npm test
npm run test:integration      # requiere docker-compose arriba (Postgres 5433 + Redis)
```

---

## 7. Estado de ejecución

| # | Commit | SHA |
|---|---|---|
| 1 | `feat(shared): stateless transaction runner + nested-transaction detector` | `48bd93f` |
| 2 | `refactor(shared): add run() to IUnitOfWork alongside the manual lifecycle` | `97f56e6` |
| 3 | `refactor(accounts): move Archive/Unarchive/Rename to uow.run()` | `30910a6` |
| 4 | `refactor(budgets): move DeleteBudget/UpdateBudgetLimit to uow.run()` | `9a396d9` |
| 5 | `refactor(transactions): move Create/DeleteTransaction to uow.run()` | `4dfe2dd` |
| 6 | `refactor(auth): express replay detection as a committed outcome` | `07bf738` |
| 7 | `refactor(shared): drop the manual lifecycle; UoW providers become singletons` | ⬜ |
| 8 | `docs: …` | ⬜ |

### Cabos sueltos a resolver en la Fase 3

| | Qué | Acción |
|---|---|---|
| 1 | `TypeOrmTransactionRunner` no extiende `IUnitOfWork` | Atar en 3.3 — inofensivo hoy (dead code), pero no olvidarlo |
| 2 | Se borró `expect(mockUow.begin).toHaveBeenCalled()` de `update-budget-limit.use-case.spec.ts` | Revisar. Legítimo (el use case ya no llama `begin()`), pero fue el único caso donde se tocó una aserción |
| 3 | `rollback-guard.integration.spec.ts` recibió un fix de tipos (`IUnitOfWork<unknown>`) | Se reemplaza entero en 3.5, queda absorbido |
| 4 | 1 warning nuevo de lint (return type del `get` del Proxy) | Trivial |

### Deuda preexistente que bloquea la puerta verde

`npx tsc --noEmit` **ya venía rojo antes de este trabajo**: 5 errores en `register.use-case.spec.ts`, `category.entity.spec.ts` (×2), `transaction.repo.implement.spec.ts`, `email.vo.spec.ts` (×2). Ajenos al plan, pero significa que **hoy no hay puerta verde de tipos** — y la Fase 3 es justo donde más se necesita.
