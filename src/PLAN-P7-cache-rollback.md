# PLAN P7 — Reacción secundaria (invalidación de caché) dentro del alcance de error de la transacción

> Alcance: **solo P7** (`src/PROBLEMS.md:294-329`). No toca P1/P2/P3/P4/P5/P6.
> Estado: plan. Ningún archivo fuente modificado.

---

## 1. Alcance real, verificado

### 1.1 Método de barrido

Tres barridos independientes, todos sobre `src/**/*.ts`:

1. `grep -n "\.commit\(\)" -A 12` sobre todo `src/` → localiza **todos** los `commit()` y muestra qué se ejecuta después de cada uno hasta el `catch`.
2. `grep -n "this\.cache\." --glob "*.use-case.ts"` → localiza **todos** los consumidores de un puerto de caché en la capa de aplicación.
3. `grep -n "uow\.|unitOfWork\.|\.rollback\(\)"` → localiza los archivos con ciclo de vida transaccional manual.

La intersección (1)∩(2) es el conjunto de defectos. Resultado: **son exactamente los dos conocidos**. Abajo la evidencia completa, no la conclusión.

### 1.2 Los 8 use cases con UoW — qué hay entre `commit()` y el `catch`

| # | Archivo:línea del `commit()` | Qué se ejecuta después, dentro del `try` | ¿Puede lanzar? | Veredicto |
|---|---|---|---|---|
| 1 | `src/modules/transactions/application/use-cases/create-transaction.use-case.ts:153` | `:154 return saved;` | No | OK |
| 2 | `src/modules/transactions/application/use-cases/delete-transaction.use-case.ts:45` | nada (`:46` es el `catch`) | — | OK |
| 3 | `src/modules/accounts/application/use-cases/archive-account.use-case.ts:32` | `:33 return saved;` | No | OK |
| 4 | `src/modules/accounts/application/use-cases/unarchive-account.use-case.ts:32` | `:33 return saved;` | No | OK |
| 5 | `src/modules/accounts/application/use-cases/rename-account.use-case.ts:33` | `:34 return saved;` | No | OK |
| 6 | `src/modules/auth/application/use-cases/refresh-token.use-case.ts:45` y `:83` | `:46`/`:84 committed = true;` y luego `throw`/`return` | No | OK — **ya protegido** con flag (ver 1.4) |
| 7 | **`src/modules/budgets/application/use-cases/update-budget-limit.use-case.ts:63`** | **`:65-68` `Promise.all([cache.invalidateUser, cache.invalidateById])`** | **Sí** | **DEFECTO** |
| 8 | **`src/modules/budgets/application/use-cases/delete-budget.use-case.ts:51`** | **`:53-56` `Promise.all([cache.invalidateUser, cache.invalidateById])`** | **Sí** | **DEFECTO** |

`return <expr>` donde `<expr>` es una variable ya evaluada no puede lanzar: no hay getters, no hay `toJSON`, no hay `await`. Los casos 1-5 son estructuralmente seguros, no seguros por suerte.

### 1.3 Los 12 puntos de caché en la capa de aplicación — cuáles están bajo un `catch` con `rollback()`

| Archivo:línea | Módulo | ¿Dentro de un `try` con `rollback()`? |
|---|---|---|
| `src/modules/budgets/application/use-cases/delete-budget.use-case.ts:54-55` | budgets | **SÍ** ← defecto |
| `src/modules/budgets/application/use-cases/update-budget-limit.use-case.ts:66-67` | budgets | **SÍ** ← defecto |
| `src/modules/budgets/application/use-cases/create-budget.use-case.ts:70` | budgets | No (sin UoW: usa `IBudgetRepository` global, `:24`) |
| `src/modules/budgets/application/use-cases/get-budget-by-id.use-case.ts:16,23` | budgets | No (lectura, sin UoW) |
| `src/modules/budgets/application/use-cases/get-budgets-by-user-id.use-case.ts:20,24` | budgets | No (lectura, sin UoW) |
| `src/modules/categories/application/use-cases/create-category.use-case.ts:36` | categories | No (sin UoW) |
| `src/modules/categories/application/use-cases/update-category.use-case.ts:35-36` | categories | No (sin UoW) |
| `src/modules/categories/application/use-cases/delete-category.use-case.ts:21-22` | categories | No (sin UoW) |
| `src/modules/categories/application/use-cases/get-category-by-id.use-case.ts:16,23` | categories | No (lectura) |
| `src/modules/categories/application/use-cases/get-categories-by-user-id.use-case.ts:14,18` | categories | No (lectura) |
| `src/modules/users/application/use-cases/update-user-profile.use-case.ts:33` | users | No (sin UoW) |
| `src/modules/users/application/use-cases/delete-user.use-case.ts:27` | users | No (sin UoW) |
| `src/modules/users/application/use-cases/get-user-by-id.use-case.ts:25,30` | users | No (lectura) |

Puertos de caché existentes en el repo: `IBudgetsCache` (`src/modules/budgets/domain/ports/cache/budgets-cache.port.ts`), `ICategoriesCache` (`src/modules/categories/domain/ports/cache/categories-cache.port.ts`), `IUsersCache` (`src/modules/users/domain/ports/cache/users-cache.port.ts`). No hay otros: `src/shared/domain/cache-decision.md:43` lo confirma (`<m>` ∈ { budgets, categories, users }) y el barrido (2) no encuentra ninguno más.

**Conclusión del alcance: son exactamente `delete-budget.use-case.ts` y `update-budget-limit.use-case.ts`. Ningún otro archivo.**

### 1.4 Precedente ya existente en el repo (relevante para el diseño del arreglo)

`RefreshTokenUseCase` resolvió el mismo problema con un flag:

```ts
// src/modules/auth/application/use-cases/refresh-token.use-case.ts:28,45-46,83-84,86-87
let committed = false;                       // :28
...
  await this.uow.commit(); committed = true; // :45-46 (rama de replay)
  throw new RefreshTokenReplayDetectedException();
...
  await this.uow.commit(); committed = true; // :83-84 (rama feliz)
  return { ... };
} catch (err) {
  if (!committed) await this.uow.rollback(); // :87
```

Es decir: **el repo ya sabía que hacer `rollback()` después de un `commit()` es incorrecto** — lo resolvió en `auth` y no propagó el criterio a `budgets`. Esto no es un descubrimiento nuevo, es una deriva.

### 1.5 Hallazgo adyacente — NO es P7, no se toca

Los 6 use cases de escritura **sin** UoW (`create-budget:70`, `create-category:36`, `update-category:34-37`, `delete-category:20-23`, `update-user-profile:33`, `delete-user:27`) también propagan un fallo de Redis como 500 sobre una escritura que **ya se persistió**. No hay enmascaramiento (no hay `rollback()` que llamar), pero el síntoma para el cliente es el mismo: 500 sobre una operación exitosa.

Lo dejo fuera del alcance porque P7 está definido como "reacción secundaria dentro del alcance de error de la transacción" y ahí no hay transacción. Pero conviene registrarlo: **si se acepta la política de la sección 2, aplicarla a estos 6 es el paso lógico siguiente** (issue separado, sin dependencia con este).

---

## 2. Análisis del comportamiento correcto

### 2.1 ¿Qué debe recibir el cliente si el commit tuvo éxito y la invalidación falla?

**El código de éxito de la operación: `204` para `DELETE /budgets/:id`, `200` para `PATCH /budgets/:id/limit`** (`src/modules/budgets/notes.md:100-101`).

Argumento, no asunción:

1. **El status HTTP describe el resultado de la operación de negocio, no el de las reacciones secundarias.** El commit ya ocurrió y es durable. Devolver 500 es una afirmación falsa sobre el estado del sistema.
2. **Un 500 induce un reintento incorrecto.** El cliente que ve 500 en `DELETE /budgets/:id` reintenta y recibe **404** (`BudgetNotFoundException`, `delete-budget.use-case.ts:27` → 404 por la tabla de `CLAUDE.md` §"Exception → HTTP mapping"). El cliente queda sin forma de saber si el borrado ocurrió. En `PATCH .../limit` el reintento es idempotente y "arregla" el síntoma, lo que es peor: el bug se vuelve intermitente e irreproducible.
3. **La invalidación no protege ningún invariante.** Es la línea divisoria que `src/PROBLEMS.md:326-329` ya establece: "lo que protege un invariante va adentro, lo que tolera latencia y fallo va afuera". Verificado abajo (2.2).
4. **Una caída de Redis no debe convertir un módulo de escritura en un módulo caído.** Hoy sí lo hace: `RedisCacheStore` usa `maxRetriesPerRequest: 3` (`src/shared/infrastructure/cache/redis-cache-store.ts:22`), o sea que cada `del`/`delByPrefix` falla rápido y de forma determinista mientras Redis esté abajo — el 500 sería el 100 % de los `DELETE`/`PATCH` de budgets, no un caso raro.

### 2.2 ¿La caché stale es tolerable? — ventana real de inconsistencia

**Sí, y la ventana está acotada por TTL.**

- **TTL = 600 s (10 min).** `const TTL_SECONDS = 600;` en `src/modules/budgets/infrastructure/cache/budgets-cache.impl.ts:8`, aplicado en `setListByUser` (`:83`) y `setById` (`:94`). Documentado como convención en `src/shared/domain/cache-decision.md:49` ("TTL: 600 s (10 min) by default in each impl").
- El TTL se aplica en el `SET ... EX` del store (`src/shared/infrastructure/cache/redis-cache-store.ts:49-56`), o sea que es un TTL real de Redis, no una convención de aplicación.

**Qué queda stale exactamente:**

| Clave | Quién la puebla | Qué se ve stale |
|---|---|---|
| `budgets:item:<id>` (`budgets-cache.impl.ts:60-62`) | `GetBudgetByIdUseCase` (`get-budget-by-id.use-case.ts:23`) | `GET /budgets/:id` devuelve un budget borrado, o el límite viejo |
| `budgets:user:<id>:list*` (`budgets-cache.impl.ts:53-58`) | `GetBudgetsByUserIdUseCase` (`get-budgets-by-user-id.use-case.ts:24`) | `GET /budgets` lista un budget borrado, o el límite viejo |

**Por qué esto NO puede romper el invariante `Σ gastos ≤ límite`:**

`CreateTransactionUseCase` lee el budget por dos caminos y **ninguno pasa por la caché**:
- el fail-fast fuera de la transacción usa `GetBudgetByUserCategoryPeriodUseCase` (`create-transaction.use-case.ts:61`), que **no aparece en el barrido de `this.cache.`** — no tiene caché;
- la lectura autoritativa la hace el repo scoped bajo `FOR UPDATE` (`create-transaction.use-case.ts:106`, `findByUserIdAndCategoryIdAndPeriod`).

Igual `UpdateBudgetLimit` y `DeleteBudget`: ambos leen con `budgetRepo.findById()` del repo scoped (`update-budget-limit.use-case.ts:34`, `delete-budget.use-case.ts:26`), nunca de la caché.

**Conclusión rigurosa: la caché de budgets está exclusivamente en el camino de lectura HTTP. Está fuera del camino de escritura y fuera del camino del invariante. Un valor stale produce una respuesta desactualizada, jamás una violación de `Σ ≤ límite` ni un balance incorrecto.** Techo de la inconsistencia: 600 s desde el último `setById`/`setListByUser`, y en la práctica menos, porque cualquier otra escritura del mismo usuario (`create-budget.use-case.ts:70`) invalida la lista.

**Matiz honesto:** si Redis está *completamente* caído, el camino de lectura también falla (`get` lanza igual que `del`), así que el escenario "stale" real es el de **fallo parcial** (timeout en `DEL`, `SCAN` interrumpido en `delByPrefix`, `redis-cache-store.ts:62-71`), no el de caída total. En caída total, lo que este arreglo compra es que las **escrituras** sigan funcionando — el hallazgo más valioso.

### 2.3 ¿Debe loguearse? Sí — `warn`, con el patrón que ya usa el repo

**Nivel `warn`, no `error`:** la operación de negocio tuvo éxito. `error` reservaría el mismo nivel para "el borrado falló" y "el borrado funcionó pero la caché no", que son incidentes de severidad distinta.

**Cómo loguea este proyecto (verificado, no de memoria):**

- pino global vía `nestjs-pino`: `LoggerModule.forRootAsync` en `src/app.module.ts:43-71`, con `genReqId` (correlation id `x-request-id`) en `:56-57` y `redact` en `:59-68`.
- `app.useLogger(app.get(Logger))` en `src/main.ts:30` — reemplaza el logger de Nest por el de pino.
- **El único precedente de logging en código de aplicación** es `src/modules/auth/application/schedulers/cleanup-expired-tokens.scheduler.ts`:
  ```ts
  import { Injectable, Logger } from '@nestjs/common';   // :1
  private readonly logger = new Logger(CleanupExpiredTokensScheduler.name);  // :7
  this.logger.log(`Cleanup: ${deleted} refresh tokens expirados eliminados`); // :15
  ```

**Seguir ese patrón exacto. Razones concretas:**

1. **Conserva el correlation id.** `app.useLogger()` hace que `new Logger(ctx)` de `@nestjs/common` delegue en el `Logger` de nestjs-pino, y éste resuelve el logger por request desde el `AsyncLocalStorage`: `node_modules/nestjs-pino/PinoLogger.js:60-63` → `storage.getStore()?.logger || outOfContext`. Como el use case corre dentro del contexto del request, el log lleva el `reqId` generado en `app.module.ts:56-57`. No hace falta inyectar `PinoLogger`.
2. **No toca el constructor.** Inyectar `PinoLogger` con `@InjectPinoLogger` agregaría un tercer parámetro y rompería **5 construcciones directas** en los specs (`delete-budget.use-case.spec.ts:51,66,81,95` y `update-budget-limit.use-case.spec.ts:46`), además de colisionar con el agente de P1/P2, que sí toca el constructor. Un campo privado no colisiona con nada.
3. **No viola ninguna regla de capas.** `CLAUDE.md` prohíbe NestJS en `domain/`, no en `application/`. Ambos archivos ya importan `@nestjs/common` (`delete-budget.use-case.ts:1`, `update-budget-limit.use-case.ts:1`) y existe el precedente de `application/schedulers/`.

**Formato del mensaje: string interpolado, un solo argumento.** No usar la forma `logger.warn(obj, 'mensaje')`: `@nestjs/common` añade su `context` como último `optionalParam` (`node_modules/@nestjs/common/services/logger.service.js:59-64`) y nestjs-pino interpreta el **último** `optionalParam` como nombre de contexto (`node_modules/nestjs-pino/Logger.js`, método `call`), así que un segundo argumento se perdería como mensaje. Con un solo string funciona correctamente y queda idéntico al precedente del scheduler.

> Alternativa estructurada, si más adelante se quiere: `this.logger.warn({ msg: '…', err: cacheError, budgetId: id })` — pino honra la clave `msg` del objeto. La dejo documentada pero **no la propongo**: introduce una forma de llamada distinta de la única que existe hoy en el repo.

---

## 3. Opciones de arreglo

### Opción A — Invalidación en su propio `try/catch`, inmediatamente después del `commit()` ✅ RECOMENDADA

```ts
await this.uow.commit();

try {
  await Promise.all([...]);
} catch (cacheError) {
  this.logger.warn(`…`);
}
```

- **Cierra el defecto completo:** el error de caché nunca llega al `catch` externo → no hay `rollback()` sobre una transacción cerrada → no hay `TransactionNotStartedError` → el cliente recibe 204/200.
- **Diff mínimo:** ~10 líneas por archivo, todas dentro del cuerpo de `execute()`.
- **Sin hoisting de variables.** `budget` (`delete-budget.use-case.ts:26`) y `updated` (`update-budget-limit.use-case.ts:62`) siguen siendo `const` dentro del `try`.
- **Robusta ante un `release()` que lance:** la invalidación ya corrió antes del `finally`.
- Explícitamente sancionada por `src/PROBLEMS.md:326-329` ("en su propio `try/catch` que solo loguee").

**Contra:** la invalidación queda *léxicamente* dentro del `try` externo. La garantía es "no puede lanzar", no "está fuera del alcance". Un futuro `await` agregado después del `commit()` y fuera del `try` interno reabre el agujero. Mitigación: el comentario explicativo + el test de la sección 4 (que falla si alguien lo reabre) + la Opción C como red estructural.

### Opción B — Mover la invalidación después del `finally`

```ts
} finally {
  await this.uow.release();
}

try { await Promise.all([...]); } catch (e) { this.logger.warn(...); }
```

- **A favor:** la estructura afirma "zona post-transaccional". Señal más fuerte.
- **En contra (tres, concretas):**
  1. **Obliga a hoistear estado fuera del `try`.** En `DeleteBudget` hay que sacar `budget.userId`; en `UpdateBudgetLimit` hay que sacar `updated` **y** mover el `return`. Con `strictNullChecks: true` (`tsconfig.json`, `"strictNullChecks": true`, sin `strict`) eso entra en el análisis de asignación definida de TS sobre `try/catch/finally`. Creo que TS lo acepta porque el `catch` termina en `throw`, **pero no lo compilé — no lo afirmo**. Es riesgo evitable.
  2. **Si `release()` lanza, la invalidación no corre.** Regresión respecto de A.
  3. **Diff mayor** → más superficie de conflicto con el agente de P1/P2.

### Opción C — Endurecer `rollback()` en los impls del UoW ✅ RECOMENDADA COMO COMPLEMENTO

**Hallazgo importante: `isActive()` NO sirve para esto.**

```ts
// src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts:290-292
isActive(): boolean { return this.queryRunner !== null; }
// src/modules/auth/infrastructure/persistence/auth-unit-of-work.impl.ts:90-92  (idéntico)
```

`isActive()` responde "¿tengo una conexión reservada?", verdadero desde `begin()` (`:270-275`) hasta `release()` (`:285-288`) — **incluido el intervalo posterior a `commit()`**. Un `if (!this.isActive()) return;` dentro de `rollback()` **no evitaría el bug**: devolvería `true` justo en el escenario de P7.

Confirmado además que `isActive()` no se usa en producción: las únicas apariciones fuera de los impls son mocks de tests (`delete-budget.use-case.spec.ts:33`, `update-budget-limit.use-case.spec.ts:40`, `archive/unarchive/rename-account.use-case.spec.ts:16`) y los fakes in-memory (`in-memory-unit-of-work.ts:41`, `in-memory-auth-unit-of-work.ts:36`). Coincide con `src/PROBLEMS.md:232`.

**El guard correcto es `queryRunner.isTransactionActive`**, propiedad de TypeORM (`node_modules/typeorm/query-runner/QueryRunner.d.ts:42`), que `commitTransaction()` pone en `false` (`node_modules/typeorm/driver/postgres/PostgresQueryRunner.js:145-146`) y que `rollbackTransaction()` consulta para lanzar `TransactionNotStartedError` (`ídem:156-157`).

```ts
async rollback(): Promise<void> {
  // No-op si no hay transacción abierta (p. ej. un commit ya cerró la tx).
  // Sin esto, TransactionNotStartedError enmascara el error real del catch.
  if (!this.queryRunner?.isTransactionActive) return;
  await this.queryRunner.rollbackTransaction();
}
```

**¿Es defensa en profundidad legítima o esconde bugs?** Legítima, con este razonamiento:

- La semántica correcta de `rollback()` es "deshacé si hay algo que deshacer". Un `rollback()` sin transacción abierta no tiene nada que deshacer; no hay estado que se corrompa por no actuar.
- Lo único que "esconde" es un doble-rollback o un rollback-sin-begin. Pero hoy ese error se manifiesta como un `TransactionNotStartedError` que **enmascara la excepción original** — la peor señal posible. El guard cambia una señal engañosa por ninguna señal; el log de la Opción A aporta la señal buena.
- **No repurposear `isActive()`.** Su semántica actual (`queryRunner !== null`) es exactamente la que P4 necesita para el guard de reentrada en `begin()` (`src/PROBLEMS.md:246`). Son dos preguntas distintas: "¿tengo conexión?" vs "¿hay transacción abierta?". Mantenerlas separadas.

**Cubre un caso que A no cubre:** si `commit()` falla *después* de que `COMMIT` ya se ejecutó — TypeORM pone `isTransactionActive = false` en `PostgresQueryRunner.js:146` y luego emite el broadcast `AfterTransactionCommit` en `:148`; si ese broadcast lanza, el `catch` llama `rollback()` sobre una transacción ya cerrada. Este camino existe en **los 8 use cases**, no solo en budgets.

**Pero C sola NO arregla P7:** sin A, el error de Redis sigue propagándose y el cliente sigue recibiendo un 500 sobre un borrado exitoso — solo que con el error correcto (`Error: connect ECONNREFUSED`) en lugar del enmascarado. **A es el arreglo; C es la red.**

### Opción D — Flag `committed`, replicando `refresh-token.use-case.ts:28,87` ❌

Isomorfa a C pero por use case y a mano. Evita el `rollback()` indebido, pero **el error de caché sigue propagando → sigue habiendo 500 sobre un borrado exitoso**. Insuficiente. Además replica ciclo de vida manual, justo lo que P4 quiere eliminar.

> Nota para el futuro: una vez adoptada C, el flag `committed` de `refresh-token.use-case.ts` queda redundante. **No lo toco en este plan** (auth está fuera del alcance de P7); anotarlo para P3/P4.

### Opción E — Fire-and-forget (`void this.cache.invalidateUser(...).catch(log)`) ❌

La respuesta HTTP podría salir antes de que la invalidación aterrice: un cliente que relee inmediatamente vería datos stale **incluso con Redis sano**. Cambia un bug determinista por una carrera. Rechazada.

### Opción F — Reintentos / outbox para la invalidación ❌

Sobre-ingeniería. El TTL de 600 s ya acota el daño y la caché no está en el camino del invariante (2.2). `CLAUDE.md` §"reports" ya sentó el criterio: nada de infraestructura de caché sin evidencia de monitoreo.

### Recomendación

**A + C.** A es obligatoria (es el arreglo). C es barata (4 líneas en 2 archivos), cubre los 8 use cases y cierra el camino `commit()`-parcialmente-exitoso que A no puede alcanzar desde la capa de aplicación.

Si hubiera que elegir una sola: **A**.

---

## 4. El test que falta

### 4.1 Estilo existente (leído, no supuesto)

- `delete-budget.use-case.spec.ts`: factory `makeMockUow(budgetRepo, hasExpenses)` (`:25-38`) que devuelve un objeto literal con `begin/commit/rollback/release/isActive` como `jest.fn()`; el use case se construye **por test** con `new DeleteBudgetUseCase(uow as unknown as IBudgetUnitOfWork, new NullBudgetsCache())` (`:51-54`); repo real in-memory (`InMemoryBudgetRepository`); aserciones sobre `repo.size()` y sobre los contadores del UoW (`:56-58`).
- `update-budget-limit.use-case.spec.ts`: `mockUow: Partial<IBudgetUnitOfWork>` construido en `beforeEach` (`:33-45`), `useCase` construido una vez en `beforeEach` (`:46-49`) con `new NullBudgetsCache()`.
- La caché en tests se moquea con el **Null Object** `NullBudgetsCache` (`src/modules/budgets/infrastructure/cache/__fakes__/null-budgets-cache.ts`), convención documentada en `src/shared/domain/cache-decision.md:41`.

### 4.2 Doble de test nuevo

Extender el Null Object en vez de escribir un mock nuevo — respeta la convención y solo sobreescribe lo que debe fallar. Definirlo **local a cada spec** (no en `__fakes__/`): es un doble de un solo caso de prueba, no un fake reutilizable del módulo.

```ts
class ExplodingBudgetsCache extends NullBudgetsCache {
  override async invalidateUser(): Promise<void> {
    throw new Error('redis down');
  }
}
```

(Un solo método basta: `Promise.all` rechaza con el primer rechazo.)

### 4.3 Test en `src/modules/budgets/application/use-cases/delete-budget.use-case.spec.ts`

Agregar al final del `describe` existente (después de `:103`):

```ts
it('should NOT roll back nor propagate when cache invalidation fails after commit', async () => {
  repo.seed([makeBudget({ id: 'b1', userId: 'user-1' })]);
  const uow = makeMockUow(repo, false);
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

  await expect(
    new DeleteBudgetUseCase(
      uow as unknown as IBudgetUnitOfWork,
      new ExplodingBudgetsCache(),
    ).execute('b1', 'user-1'),
  ).resolves.toBeUndefined();          // SÍ: la operación reporta éxito

  expect(repo.size()).toBe(0);          // SÍ: la operación de negocio ocurrió
  expect(uow.commit).toHaveBeenCalledTimes(1);
  expect(uow.rollback).not.toHaveBeenCalled();   // NO: rollback sobre tx commiteada
  expect(uow.release).toHaveBeenCalledTimes(1);  // el finally sigue corriendo
  expect(warn).toHaveBeenCalledTimes(1);         // el fallo queda registrado

  warn.mockRestore();
});
```

`Logger` se importa de `@nestjs/common` en el spec. El `spyOn(Logger.prototype, 'warn')` evita ruido en la salida de jest y convierte "se loguea" en una aserción.

### 4.4 Test en `src/modules/budgets/application/use-cases/update-budget-limit.use-case.spec.ts`

Este spec construye `useCase` en `beforeEach` con `NullBudgetsCache` (`:46-49`), así que el test nuevo construye su propia instancia:

```ts
it('should NOT roll back nor propagate when cache invalidation fails after commit', async () => {
  budgetRepo.seed([makeBudget({ id: 'b1', userId: 'user-1', limit: 300 })]);
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

  const result = await new UpdateBudgetLimitUseCase(
    mockUow as IBudgetUnitOfWork,
    new ExplodingBudgetsCache(),
  ).execute({ id: 'b1', requestUserId: 'user-1', limit: 800 });

  expect(result.getLimit().getValue()).toBe(800);   // SÍ: devuelve el resultado
  expect(mockUow.commit).toHaveBeenCalledTimes(1);
  expect(mockUow.rollback).not.toHaveBeenCalled();  // NO
  expect(mockUow.release).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);

  warn.mockRestore();
});
```

### 4.5 Test de regresión inversa (1 línea, opcional pero barato)

Impedir que alguien "arregle" esto moviendo la invalidación **antes** del commit. En el test existente `'should throw BudgetLimitBelowSpentException when limit is below spent'` (`update-budget-limit.use-case.spec.ts:87-98`), inyectar un `IBudgetsCache` espiado y agregar:

```ts
expect(cacheSpy.invalidateUser).not.toHaveBeenCalled();
```

Fija la regla: **si la transacción aborta, la caché no se toca.**

### 4.6 Rojo antes de verde — qué falla hoy exactamente

Con el código actual, el test de 4.3 falla en **dos** aserciones: `resolves` (la promesa rechaza con `Error('redis down')`) y `rollback` (se llama una vez, `delete-budget.use-case.ts:58`).

**Limitación honesta del test unitario:** no reproduce el `TransactionNotStartedError`. El mock `rollback: jest.fn().mockResolvedValue(undefined)` (`delete-budget.use-case.spec.ts:31`) resuelve sin error, así que en el unitario el error que se propaga es el de Redis, no el enmascarado. El enmascaramiento requiere un `QueryRunner` real de TypeORM.

Lo que el unitario **sí** fija son las dos propiedades que están bajo nuestro control y de las cuales el enmascaramiento es una consecuencia: (a) no se llama `rollback()` después de un `commit()` exitoso, (b) el fallo de caché no llega al llamador. Con (a) garantizada, el `TransactionNotStartedError` es inalcanzable por construcción.

### 4.7 ¿Hace falta test de integración?

**Para la Opción A: no.** El unitario cubre el contrato completo de la capa de aplicación. Un test de integración equivalente (levantar el app con `createTestApp()` — `test/helpers/app-bootstrap.ts:20-45` — sobreescribiendo `IBudgetsCache` por un doble que lanza, y verificar `204` + fila borrada) exigiría **agregar un hook de `overrideProvider` al helper compartido**, que hoy no lo acepta (`:29-31` compila `AppModule` sin overrides). Cambiar un helper que usan las 9 suites de `test/integration/` a cambio de valor marginal sobre el unitario: mal negocio, y aumenta la superficie de conflicto.

**Para la Opción C: sí, uno pequeño, y es el que realmente importa.** La corrección de C depende de una semántica de TypeORM (`commitTransaction()` pone `isTransactionActive=false`, `PostgresQueryRunner.js:145-146`) que ningún mock puede verificar y que un bump mayor de TypeORM podría cambiar en silencio. Test propuesto, con Postgres real, natural en `test/integration/concurrency/concurrency.integration.spec.ts` o en un archivo nuevo:

```
begin() → commit() → rollback()  ⇒  no lanza
begin() → rollback() → (sin release) → rollback()  ⇒  no lanza
begin() → commit() → release()  ⇒  la conexión vuelve al pool
```

Sin C, este test no aplica y el unitario basta.

---

## 5. Cambios archivo por archivo

### 5.1 `src/modules/budgets/application/use-cases/delete-budget.use-case.ts`

**Cambio 1 — línea 1 (import).**

```diff
-import { Injectable } from '@nestjs/common';
+import { Injectable, Logger } from '@nestjs/common';
```

**Cambio 2 — insertar 2 líneas tras la línea 11 (`export class DeleteBudgetUseCase {`), antes del constructor.**

```diff
 export class DeleteBudgetUseCase {
+  private readonly logger = new Logger(DeleteBudgetUseCase.name);
+
   constructor(
```

**Cambio 3 — bloque `53-56` (antes) → `try/catch` propio.**

Antes (`:50-62`):

```ts
50      await budgetRepo.delete(id);
51      await this.uow.commit();
52
53      await Promise.all([
54        this.cache.invalidateUser(budget.userId),
55        this.cache.invalidateById(id),
56      ]);
57    } catch (error) {
58      await this.uow.rollback();
59      throw error;
60    } finally {
61      await this.uow.release();
62    }
```

Después (numeración resultante ≈ `52-75`, con los cambios 1-2 aplicados):

```ts
      await budgetRepo.delete(id);
      await this.uow.commit();

      // POST-COMMIT: la transacción ya está cerrada y es durable. La invalidación
      // de caché es una reacción secundaria y va en su PROPIO try/catch: si cayera
      // al catch de abajo, dispararía rollback() sobre una transacción commiteada
      // → TransactionNotStartedError, que enmascara el error real y convierte un
      // borrado exitoso en un 500. La caché stale es tolerable (TTL 600 s,
      // budgets-cache.impl.ts) y no participa de ningún invariante.
      try {
        await Promise.all([
          this.cache.invalidateUser(budget.userId),
          this.cache.invalidateById(id),
        ]);
      } catch (cacheError) {
        this.logger.warn(
          `Budget ${id} borrado y commiteado, pero falló la invalidación de caché ` +
            `(user ${budget.userId}). Las lecturas pueden quedar stale hasta el TTL. ` +
            `Causa: ${(cacheError as Error).message}`,
        );
      }
    } catch (error) {
      await this.uow.rollback();
      throw error;
    } finally {
      await this.uow.release();
    }
```

**No se toca:** líneas 17-51 (todo el cuerpo transaccional, los locks, las validaciones de ownership y el `delete`), ni el `catch`/`finally` externos, ni el constructor, ni las líneas 2-8 de imports.

### 5.2 `src/modules/budgets/application/use-cases/update-budget-limit.use-case.ts`

**Cambio 1 — línea 1.** Idéntico a 5.1.

**Cambio 2 — insertar 2 líneas tras la línea 19 (`export class UpdateBudgetLimitUseCase {`).**

```diff
 export class UpdateBudgetLimitUseCase {
+  private readonly logger = new Logger(UpdateBudgetLimitUseCase.name);
+
   constructor(
```

**Cambio 3 — bloque `65-68` (antes).**

Antes (`:62-75`):

```ts
62      const updated = await budgetRepo.save(budget);
63      await this.uow.commit();
64
65      await Promise.all([
66        this.cache.invalidateUser(updated.userId),
67        this.cache.invalidateById(updated.id),
68      ]);
69      return updated;
70    } catch (error) {
71      await this.uow.rollback();
72      throw error;
73    } finally {
74      await this.uow.release();
75    }
```

Después (numeración resultante ≈ `64-88`):

```ts
      const updated = await budgetRepo.save(budget);
      await this.uow.commit();

      // POST-COMMIT: ver el comentario equivalente en delete-budget.use-case.ts.
      // Un fallo de Redis no puede disparar el rollback de una transacción cerrada.
      try {
        await Promise.all([
          this.cache.invalidateUser(updated.userId),
          this.cache.invalidateById(updated.id),
        ]);
      } catch (cacheError) {
        this.logger.warn(
          `Budget ${updated.id} actualizado y commiteado, pero falló la invalidación ` +
            `de caché (user ${updated.userId}). Las lecturas pueden quedar stale hasta ` +
            `el TTL. Causa: ${(cacheError as Error).message}`,
        );
      }
      return updated;
    } catch (error) {
      await this.uow.rollback();
      throw error;
    } finally {
      await this.uow.release();
    }
```

**No se toca:** líneas 12-16 (`UpdateBudgetLimitCommand`), 25-63 (cuerpo transaccional), el `catch`/`finally` externos ni el constructor.

### 5.3 `src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts` (Opción C)

Antes (`:281-283`):

```ts
281  async rollback(): Promise<void> {
282    await this.queryRunner?.rollbackTransaction();
283  }
```

Después:

```ts
  async rollback(): Promise<void> {
    // No-op si no hay transacción abierta: un commit previo ya la cerró
    // (typeorm pone isTransactionActive=false en commitTransaction()).
    // Sin este guard, rollbackTransaction() lanza TransactionNotStartedError
    // y enmascara la excepción original que llevó al catch del use case.
    if (!this.queryRunner?.isTransactionActive) return;
    await this.queryRunner.rollbackTransaction();
  }
```

**No se toca:** `begin()` (`:270-275`), `commit()` (`:277-279`), `release()` (`:285-288`), `isActive()` (`:290-292`) ni ninguno de los getters scoped (`:294+`). En particular **`isActive()` conserva su semántica** (`queryRunner !== null`), porque P4 la necesita así para el guard de reentrada en `begin()`.

### 5.4 `src/modules/auth/infrastructure/persistence/auth-unit-of-work.impl.ts` (Opción C)

Antes (`:81-83`):

```ts
81  async rollback(): Promise<void> {
82    await this.queryRunner?.rollbackTransaction();
83  }
```

Después: idéntico a 5.3.

Efecto colateral positivo: `RefreshTokenUseCase` deja de depender del flag `committed` (`refresh-token.use-case.ts:28,87`) para su corrección. **El flag no se elimina en este PR** (auth está fuera del alcance de P7); anotarlo como limpieza para P3/P4.

### 5.5 Specs

- `src/modules/budgets/application/use-cases/delete-budget.use-case.spec.ts` — añadir el import de `Logger`, la clase `ExplodingBudgetsCache` (junto a `FakeExpenseChecker`, `:13-23`) y el `it(...)` de 4.3 al final del `describe` (tras `:103`).
- `src/modules/budgets/application/use-cases/update-budget-limit.use-case.spec.ts` — ídem: `Logger`, `ExplodingBudgetsCache` (junto a `FakeExpenseChecker`, `:14-26`) y el `it(...)` de 4.4 tras `:106`.
- Si se adopta C: test de integración de 4.7 en `test/integration/concurrency/concurrency.integration.spec.ts` o archivo nuevo bajo `test/integration/`.

### 5.6 Documentación (mismo PR, regla de `CLAUDE.md`)

- `src/PROBLEMS.md:294-329` — marcar P7 como resuelto (o mover a un apartado de "cerrados"), y actualizar la fila de la tabla `:396` y el orden sugerido `:404`.
- `src/modules/budgets/notes.md:68-69` — las descripciones de `UpdateBudgetLimitUseCase` / `DeleteBudgetUseCase` terminan en "commit" y no mencionan la invalidación. Añadir media línea: "…→ commit → invalidación de caché best-effort (fuera del alcance de error de la tx)".
- `src/shared/domain/cache-decision.md` §5 ("Rules for anyone touching the module", `:261-269`) — añadir una regla: **la invalidación va después del commit y su fallo se loguea, nunca se propaga ni dispara rollback.**
- `CLAUDE.md` §"Anti-patterns — do not do" — añadir: *"**Do not** put cache invalidation (or any secondary reaction) inside the `try` that a `rollback()` catches. It runs after `commit()`, in its own `try/catch` that only logs."*

**No hace falta tocar** la tabla de mapeo excepción→HTTP de `CLAUDE.md`: no se agrega ni se quita ninguna excepción de dominio.

---

## 6. Riesgos y qué NO tocar

### 6.1 Prohibido: invalidar antes del `commit()`

Sería estrictamente peor y por una razón que no es obvia. Entre la invalidación y el commit se abre una ventana en la que un `GET /budgets/:id` concurrente encuentra la clave vacía, lee de la DB el estado **pre-commit** y lo repuebla con `setById` (`get-budget-by-id.use-case.ts:23`) y TTL 600 s (`budgets-cache.impl.ts:94`). Resultado: la caché queda envenenada con el valor viejo **y el TTL arranca en ese momento**, así que la inconsistencia dura hasta 600 s *contados desde el GET*, no desde el commit. Y si la transacción aborta, se pagó una invalidación inútil. El orden `commit → invalidación` es correcto y **no se toca**.

### 6.2 Prohibido: alterar la semántica transaccional

- No mover, agregar ni quitar `begin()`, `commit()` o `release()`.
- No cambiar el orden de los locks ni las lecturas bajo `FOR UPDATE` (`delete-budget.use-case.ts:26,33-40`; `update-budget-limit.use-case.ts:34,42-49`). El mutex lógico de la fila de budget sigue igual — el arreglo es puramente post-commit.
- No cambiar la semántica de `isActive()` (ver 5.3).
- No convertir el `catch` externo en algo que trague errores. Sigue siendo `rollback(); throw error;`.

### 6.3 Riesgo: `catch` vacío por accidente

El `catch (cacheError)` **debe** loguear. Un `catch {}` silencioso convierte P7 en un fallo invisible: la caché quedaría stale sin ninguna señal operativa. El test de 4.3/4.4 asegura con `expect(warn).toHaveBeenCalledTimes(1)` que el log existe.

### 6.4 Riesgo: umbrales de cobertura

`package.json` §`jest.coverageThreshold` exige `branches: 70` en `src/modules/**/application/**/*.ts`. El nuevo `catch` agrega una rama por archivo; los tests de 4.3/4.4 la cubren. Si se omitieran los tests, `npm run test:cov` podría bajar el porcentaje. Los tests no son opcionales.

### 6.5 Riesgo: nivel de log y ruido

`warn` con Redis caído genera una línea por escritura de budget. Es lo deseable (visibilidad del incidente) y el volumen está acotado por el throttler global (`app.module.ts:91-97`, `THROTTLE_LIMIT` por defecto 100/min/IP). No usar `error`: reservado para fallos de la operación de negocio.

### 6.6 Riesgo bajo pero real: `release()` que lanza

Fuera del alcance de P7, pero conviene registrarlo: si `this.uow.release()` en el `finally` lanza, el error se propaga y el cliente ve un 500 aunque el commit haya sido exitoso — en los 8 use cases. La Opción A es robusta ante esto (la invalidación ya corrió). Cerrarlo del todo es trabajo de P3/P4 (runner por callback). **No abrir ese frente acá.**

### 6.7 Lo que este plan NO resuelve, deliberadamente

- Los 6 use cases sin UoW de la sección 1.5.
- El flag `committed` redundante de `refresh-token.use-case.ts`.
- La falta de un circuit breaker / degradación explícita de Redis a nivel `ICacheStore`.

---

## 7. Coordinación con el plan de P1/P2 (mi cambio va PRIMERO)

### 7.1 Líneas que toco

| Archivo | Líneas (estado ACTUAL) | Naturaleza |
|---|---|---|
| `delete-budget.use-case.ts` | `1` (import), inserción tras `11`, bloque `50-56` | import + campo de clase + cuerpo de `execute()` |
| `update-budget-limit.use-case.ts` | `1` (import), inserción tras `19`, bloque `62-68` | import + campo de clase + cuerpo de `execute()` |
| `unit-of-work.impl.ts` | `281-283` | solo `rollback()` |
| `auth-unit-of-work.impl.ts` | `81-83` | solo `rollback()` |
| `delete-budget.use-case.spec.ts` | import de `Logger`, inserción tras `23`, inserción tras `103` | solo añadidos |
| `update-budget-limit.use-case.spec.ts` | import de `Logger`, inserción tras `26`, inserción tras `106` | solo añadidos |

### 7.2 Líneas que NO toco (las de P1/P2)

- **Los imports de puertos:** `delete-budget.use-case.ts:2-8`, `update-budget-limit.use-case.ts:2-10`. Solo modifico la **línea 1** (`@nestjs/common`), que P1/P2 no necesitan tocar.
- **Los constructores:** `delete-budget.use-case.ts:12-15` y `update-budget-limit.use-case.ts:20-23`. Intactos — no cambio el tipo ni el orden de los parámetros. El token `IBudgetUnitOfWork` sigue exactamente donde está.
- **`budgets.module.ts`** — no lo toco en absoluto.
- **Las clases scoped** (`ScopedBudgetRepository`, `ScopedAccountRepository`, `ScopedExpenseChecker`) dentro de `unit-of-work.impl.ts` — no las toco. Solo modifico el método `rollback()` de `TypeOrmUnitOfWorkImpl`.
- **`isActive()`** en ambos impls — intacto, y es deliberado: P4 lo necesita con su semántica actual.

### 7.3 Cómo quedan los archivos DESPUÉS de mi cambio (para que P1/P2 reanclen)

Tras aplicar 5.1 y 5.2, en cada archivo se insertan **2 líneas antes del constructor** (el campo `logger` + una línea en blanco) y la línea 1 cambia de contenido pero no de posición. Anclas nuevas:

| Archivo | Constructor ANTES | Constructor DESPUÉS |
|---|---|---|
| `delete-budget.use-case.ts` | `12-15` | `14-17` |
| `update-budget-limit.use-case.ts` | `20-23` | `22-25` |

Los imports de puertos conservan su numeración (`delete-budget.use-case.ts:2-8`, `update-budget-limit.use-case.ts:2-10`), porque la única línea modificada arriba del bloque es la 1 y no cambia de altura.

### 7.4 Interacción semántica con P1/P2

Ninguna. P1/P2 cambia **de dónde viene** la implementación de `IBudgetUnitOfWork` (de `TypeOrmUnitOfWorkImpl` en `transactions/` a un `BudgetUnitOfWorkImpl` en `budgets/`). Mi cambio 5.3 endurece `rollback()` en `TypeOrmUnitOfWorkImpl`.

> **Nota explícita para el agente de P1/P2:** el nuevo `BudgetUnitOfWorkImpl` (y el `AccountUnitOfWorkImpl`) deben copiar el `rollback()` **ya endurecido** (5.3), no la versión actual de `unit-of-work.impl.ts:281-283`. Si se copia la vieja, P7 se reabre en el módulo nuevo. Es el único punto de contacto entre los dos planes.

### 7.5 Orden de aplicación sugerido

1. 5.1 + 5.2 (arreglo puntual) + 5.5 specs → `npm test` verde, con los dos tests nuevos en rojo antes del arreglo.
2. 5.3 + 5.4 (endurecimiento) + test de integración de 4.7 → `npm run test:integration`.
3. 5.6 (docs).
4. Recién entonces, P1/P2.
