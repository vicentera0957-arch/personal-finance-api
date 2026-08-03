# PLAN P7 — Reacción secundaria dentro del alcance de error de la transacción

> **Problema:** `src/PROBLEMS.md:237-272`.
> **Alcance:** el defecto de P7 + el renombre de `isActive()` → `isConnected()`.
> **Estado:** plan. Ningún archivo fuente modificado.
> **Verificado contra:** `d83bd3e`. Todos los números de línea de este documento fueron
> leídos en ese commit; si el árbol se movió, revalidar antes de aplicar.
> **Reemplaza** la versión anterior de este plan, escrita cuando P1/P2 estaban abiertos.
> Equivalencia de nomenclatura con esa versión: `A(v1) = A`, `C(v1) = B`; el resto de las
> letras de v1 (B/D/E/F) eran alternativas descartadas y están en §2.2.

---

## 0. Tabla maestra de cambios

| # | Archivo | Líneas (estado `d83bd3e`) | Cambio | Commit |
|---|---|---|---|---|
| A1 | `src/modules/budgets/application/use-cases/delete-budget.use-case.ts` | `1`, tras `11`, `53-56` | import `Logger` + campo + `try/catch` propio | 1 |
| A2 | `src/modules/budgets/application/use-cases/update-budget-limit.use-case.ts` | `1`, tras `19`, `65-68` | ídem | 1 |
| A3 | `src/modules/budgets/application/use-cases/delete-budget.use-case.spec.ts` | tras `23`, tras `103` | doble + test nuevo | 1 |
| A4 | `src/modules/budgets/application/use-cases/update-budget-limit.use-case.spec.ts` | tras `26`, `87-98`, tras `106` | doble + test nuevo + aserción inversa | 1 |
| B1 | `src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts` | `137-139` | guard en `rollback()` | 2 |
| B2 | `src/modules/budgets/infrastructure/persistence/budget-unit-of-work.impl.ts` | `33-35` | ídem | 2 |
| B3 | `src/modules/accounts/infrastructure/persistence/account-unit-of-work.impl.ts` | `31-33` | ídem | 2 |
| B4 | `src/modules/auth/infrastructure/persistence/auth-unit-of-work.impl.ts` | `81-83` | ídem | 2 |
| B5 | `test/integration/` (archivo nuevo o dentro de `concurrency.integration.spec.ts`) | — | 3 aserciones de ciclo de vida | 2 |
| C1–C17 | puerto + 4 impls + 2 fakes + 5 mocks + 5 docs | ver §5.3 | `isActive()` → `isConnected()` | 3 |
| D1 | `src/PROBLEMS.md`, `src/modules/budgets/notes.md`, `src/shared/domain/cache-decision.md`, `CLAUDE.md` | ver §7 | cierre de P7 + regla nueva | 4 |

**Nada más se toca.** El cuerpo transaccional de los dos use cases, los locks, los constructores,
los `.module.ts` y el orden `commit → invalidación` quedan intactos (§10).

---

## 1. El defecto

`delete-budget.use-case.ts:50-62` (idéntico en `update-budget-limit.use-case.ts:62-75`):

```ts
50      await budgetRepo.delete(id);
51      await this.uow.commit();          // ← el borrado ya es durable
52
53      await Promise.all([               // ← si esto lanza (Redis caído)…
54        this.cache.invalidateUser(budget.userId),
55        this.cache.invalidateById(id),
56      ]);
57    } catch (error) {
58      await this.uow.rollback();        // ← …rollback sobre una tx CERRADA
59      throw error;                      // ← TransactionNotStartedError, no el de Redis
60    } finally {
```

**Cadena de fallo:** Redis abajo → `invalidateUser` lanza → `catch` → `rollback()` sobre transacción
commiteada → TypeORM lanza `TransactionNotStartedError` → **enmascara el error real** → el cliente
recibe `500` sobre una operación que tuvo éxito.

**No es un caso raro.** `RedisCacheStore` usa `maxRetriesPerRequest: 3`
(`src/shared/infrastructure/cache/redis-cache-store.ts:22`): con Redis caído, `del`/`delByPrefix`
fallan rápido y de forma determinista. Serían el **100 %** de los `DELETE /budgets/:id` y
`PATCH /budgets/:id/limit`, no un porcentaje.

**Consecuencia peor que el 500:** un cliente que ve `500` en un `DELETE` reintenta y recibe `404`
(`BudgetNotFoundException`, `delete-budget.use-case.ts:27`), sin forma de saber si el borrado
ocurrió. En `PATCH` el reintento es idempotente y "arregla" el síntoma — el bug se vuelve
intermitente e irreproducible.

---

## 2. Decisiones

### 2.1 Las tres que se aplican

| | Cambio | Qué resuelve | Por qué no alcanza sin las otras |
|---|---|---|---|
| **A** | Invalidación en su propio `try/catch` que solo loguea (`warn`) | **Es el arreglo.** El error de Redis no llega al `catch` externo → no hay rollback indebido → el cliente recibe 204/200 | Deja `rollback()` sin protección para el próximo llamador que se equivoque |
| **B** | `rollback()` no-op si no hay transacción abierta, en los **4** impls | Red estructural. Cubre el camino que A no alcanza: si el broadcast `AfterTransactionCommit` de TypeORM lanza *después* del `COMMIT`, el `catch` vuelve a llamar `rollback()` — existe en los **8** use cases transaccionales | **B sola no arregla P7:** el error de Redis sigue propagando y el cliente sigue viendo 500, solo que con el error correcto |
| **C** | `isActive()` → `isConnected()` | Cierra la trampa de nombres que produjo este defecto (§5.1) | Ninguna — es independiente y severable |

**Si hubiera que aplicar una sola: A.**

### 2.2 Las descartadas, con el motivo en una línea

| Alternativa | Motivo del descarte |
|---|---|
| Mover la invalidación después del `finally` | Obliga a hoistear `budget`/`updated` fuera del `try`, mueve el `return`, y **si `release()` lanza la invalidación no corre** — regresión respecto de A |
| Flag `committed` por use case (como `refresh-token.use-case.ts:28,45-46,83-84,87`) | Evita el rollback indebido pero **el error de Redis sigue propagando** → sigue habiendo 500 sobre un borrado exitoso |
| Fire-and-forget (`void cache.invalidate().catch(log)`) | La respuesta HTTP puede salir antes de que la invalidación aterrice: cambia un bug determinista por una carrera, **incluso con Redis sano** |
| Reintentos / outbox | Sobre-ingeniería: el TTL de 600 s ya acota el daño y la caché no está en el camino del invariante (§2.3) |
| Invalidar **antes** del `commit()` | Estrictamente peor: ver §10.1 |

### 2.3 Por qué es correcto devolver 204/200 con la caché stale

Tres hechos verificados, no supuestos:

1. **La caché de budgets está solo en el camino de lectura HTTP.** `CreateTransaction` lee el budget
   por `GetBudgetByUserCategoryPeriodUseCase` (`create-transaction.use-case.ts:61`, sin caché) y por
   el repo scoped bajo `FOR UPDATE` (`:106`). `UpdateBudgetLimit` y `DeleteBudget` leen con
   `budgetRepo.findById()` del repo scoped (`update-budget-limit.use-case.ts:34`,
   `delete-budget.use-case.ts:26`). **Ninguno lee de la caché** → un valor stale jamás puede violar
   `Σ gastos ≤ límite` ni producir un balance incorrecto.
2. **La ventana está acotada por TTL real de Redis:** 600 s (`budgets-cache.impl.ts:8`, aplicado en
   `setListByUser` y `setById`), y en la práctica menos, porque cualquier otra escritura del mismo
   usuario invalida la lista (`create-budget.use-case.ts:70`).
3. **El status HTTP describe la operación de negocio, no sus reacciones secundarias.** El commit
   ocurrió y es durable; devolver 500 es una afirmación falsa sobre el estado del sistema.

> **Matiz honesto:** con Redis *completamente* caído el camino de lectura también falla (`get` lanza
> igual que `del`), así que el escenario "stale" real es el de **fallo parcial** (timeout en `DEL`,
> `SCAN` interrumpido en `delByPrefix`). En caída total, lo que este arreglo compra es que las
> **escrituras sigan funcionando** — el valor principal del cambio.

---

## 3. Cambio A — la invalidación fuera del alcance de error

### 3.1 `src/modules/budgets/application/use-cases/delete-budget.use-case.ts`

**A1.a — línea `1`:**

```diff
-import { Injectable } from '@nestjs/common';
+import { Injectable, Logger } from '@nestjs/common';
```

**A1.b — insertar 2 líneas tras `11` (`export class DeleteBudgetUseCase {`):**

```diff
 export class DeleteBudgetUseCase {
+  private readonly logger = new Logger(DeleteBudgetUseCase.name);
+
   constructor(
```

**A1.c — bloque `53-56` → `try/catch` propio:**

```ts
      await budgetRepo.delete(id);
      await this.uow.commit();

      // POST-COMMIT: la transacción está cerrada y es durable. La invalidación de
      // caché es una reacción secundaria y va en su PROPIO try/catch: si cayera al
      // catch de abajo dispararía rollback() sobre una tx commiteada →
      // TransactionNotStartedError, que enmascara el error real y convierte un
      // borrado exitoso en un 500. La caché stale es tolerable (TTL 600 s,
      // budgets-cache.impl.ts:8) y no participa de ningún invariante.
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
```

**Efecto en anclas:** el constructor pasa de `12-15` a `14-17`. Los imports de puertos (`2-8`)
conservan su numeración: la única línea modificada arriba es la `1`, y no cambia de altura.

### 3.2 `src/modules/budgets/application/use-cases/update-budget-limit.use-case.ts`

**A2.a — línea `1`:** idéntico a A1.a.

**A2.b — insertar 2 líneas tras `19` (`export class UpdateBudgetLimitUseCase {`):**

```diff
 export class UpdateBudgetLimitUseCase {
+  private readonly logger = new Logger(UpdateBudgetLimitUseCase.name);
+
   constructor(
```

**A2.c — bloque `65-68`. El `return updated;` de `:69` queda DESPUÉS del `catch` interno:**

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
```

**Efecto en anclas:** constructor `20-23` → `22-25`; imports `2-10` sin mover.

### 3.3 Por qué `new Logger(...)` de `@nestjs/common` y no `PinoLogger` inyectado

| Criterio | Verificación |
|---|---|
| **Conserva el correlation id** | `app.useLogger(app.get(Logger))` (`src/main.ts:30`) hace que `new Logger(ctx)` delegue en nestjs-pino, que resuelve el logger por request desde `AsyncLocalStorage`. El `reqId` de `app.module.ts:56-57` va en la línea |
| **No toca el constructor** | Inyectar `PinoLogger` agregaría un 3.º parámetro y rompería **5 construcciones directas** en los specs (`delete-budget.use-case.spec.ts:51,66,81,95`, `update-budget-limit.use-case.spec.ts:46`) |
| **No viola capas** | `CLAUDE.md` prohíbe NestJS en `domain/`, no en `application/`. Ambos archivos ya importan `@nestjs/common` en `:1` |
| **Hay precedente exacto** | `src/modules/auth/application/schedulers/cleanup-expired-tokens.scheduler.ts:1,7,15` — mismo import, mismo campo, mismo formato |

**Formato del mensaje: un solo string interpolado.** No usar `logger.warn(obj, 'msg')`:
`@nestjs/common` añade su `context` como último `optionalParam` y nestjs-pino interpreta el último
`optionalParam` como nombre de contexto, así que el segundo argumento se perdería.

**Nivel `warn`, no `error`:** la operación de negocio tuvo éxito. `error` daría la misma severidad a
"el borrado falló" y a "el borrado funcionó pero la caché no".

---

## 4. Cambio B — `rollback()` con guard, en los cuatro impls

### 4.1 Las dos preguntas — no confundirlas nunca más

| Pregunta | Cómo se responde | Quién la usa |
|---|---|---|
| ¿Tengo una conexión reservada? | `this.queryRunner !== null` → `isConnected()` tras §5 | guard de reentrada de `begin()` (P4, diferido) |
| ¿Hay una transacción **abierta**? | `queryRunner.isTransactionActive` (propiedad de TypeORM) | **el guard de este cambio** |

`commitTransaction()` pone `isTransactionActive = false`
(`node_modules/typeorm/driver/postgres/PostgresQueryRunner.js:145-146`) y `rollbackTransaction()`
la consulta para lanzar `TransactionNotStartedError` (`ídem:156-157`). Por eso el guard correcto es
la propiedad de TypeORM, **no** el método del puerto.

### 4.2 El diff, idéntico en los cuatro archivos

```diff
   async rollback(): Promise<void> {
-    await this.queryRunner?.rollbackTransaction();
+    // No-op si no hay transacción abierta: un commit previo ya la cerró (typeorm
+    // pone isTransactionActive=false en commitTransaction()). Sin este guard,
+    // rollbackTransaction() lanza TransactionNotStartedError y enmascara la
+    // excepción original que llevó al catch del use case.
+    if (!this.queryRunner?.isTransactionActive) return;
+    await this.queryRunner.rollbackTransaction();
   }
```

| # | Archivo | Líneas |
|---|---|---|
| B1 | `src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts` | `137-139` |
| B2 | `src/modules/budgets/infrastructure/persistence/budget-unit-of-work.impl.ts` | `33-35` |
| B3 | `src/modules/accounts/infrastructure/persistence/account-unit-of-work.impl.ts` | `31-33` |
| B4 | `src/modules/auth/infrastructure/persistence/auth-unit-of-work.impl.ts` | `81-83` |

> **Por qué son cuatro y no dos (corrección respecto de la v1 de este plan):** la v1 asumía que P7
> se aplicaba **antes** que P1/P2 y avisaba que los impls nuevos debían copiar el `rollback()` ya
> endurecido. Se ejecutó al revés: `budget-unit-of-work.impl.ts:33-35` y
> `account-unit-of-work.impl.ts:31-33` copiaron la versión sin guard. No es grave —P7 no se aplicó
> en ningún lado todavía— pero el alcance de B ahora son los cuatro.

**Los fakes no cambian.** `InMemoryUnitOfWork.rollback()` y `InMemoryAuthUnitOfWork.rollback()` no
tocan TypeORM; solo incrementan `_rollbacks`. Con A aplicado, el use case ya no los llama después
de un commit.

### 4.3 ¿Es defensa en profundidad legítima o esconde bugs?

Legítima. La semántica correcta de `rollback()` es *"deshacé si hay algo que deshacer"*; sin
transacción abierta no hay estado que se corrompa por no actuar. Lo único que "esconde" es un
doble-rollback o un rollback-sin-begin — que **hoy** se manifiestan como un
`TransactionNotStartedError` que enmascara la excepción original, o sea la peor señal posible. El
guard cambia una señal engañosa por ninguna; el `warn` de A aporta la señal buena.

---

## 5. Cambio C — `isActive()` → `isConnected()`

### 5.1 La evidencia de que el nombre miente

Las dos familias de implementaciones del mismo método abstracto **ya no significan lo mismo**:

| Implementación | Cuándo devuelve `false` | Semántica real |
|---|---|---|
| Los 4 impls reales (`unit-of-work.impl.ts:146-148` y hermanos) | solo tras `release()` | "hay conexión reservada" |
| Los 2 fakes (`in-memory-unit-of-work.ts:41-43`, `in-memory-auth-unit-of-work.ts:36-38`) | tras `commit()` **y** tras `rollback()` (`this.active = false` en ambos) | "hay transacción abierta" |

Nadie lo notó porque **el método no se llama desde ningún lado en producción** — sus únicas
apariciones fuera de impls y fakes son 5 mocks de specs que nunca lo asertan (§5.3, puntos 8-12).

El nombre ya indujo un segundo error: `src/PROBLEMS.md:174` propone `if (this.isActive()) throw` al
inicio de `begin()` —correcto para *ese* uso— y el enunciado original de P7 dio a entender que el
mismo método servía como guard de `rollback()`, donde es un **no-op**: devuelve `true` justo en el
escenario del defecto. Renombrar convierte esa ambigüedad en imposible de escribir.

### 5.2 Por qué `isConnected()` y no otro nombre

| Candidato | Veredicto |
|---|---|
| **`isConnected()`** | ✅ Describe el hecho real (`queryRunner !== null` ⇔ conexión reservada). No colisiona con ningún miembro de `QueryRunner` de TypeORM (`isReleased`, `isTransactionActive`) ni con `DataSource.isInitialized` |
| `hasOpenTransaction()` | ❌ Sería **mentira** con la implementación actual: devuelve `true` después del commit |
| `isTransactionActive()` | ❌ Reintroduce la confusión: mismo nombre que la propiedad de TypeORM, semántica distinta |
| `hasReservedConnection()` | Correcto pero verboso; `isConnected()` dice lo mismo junto a `connect()`, que es lo que `begin()` llama |

### 5.3 Los 17 puntos a tocar

**Renombre puro** (el compilador encuentra todos los usos; ningún cambio de comportamiento):

| # | Archivo | Línea(s) | Nota |
|---|---|---|---|
| C1 | `src/shared/domain/IUnitOfWork.ts` | `20` | `abstract isConnected(): boolean;` + jsdoc de una línea: *"¿hay una conexión reservada? True entre begin() y release(), INCLUIDO después del commit. Para saber si hay transacción abierta es `queryRunner.isTransactionActive`."* |
| C2 | `src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts` | `146-148` y el comentario `125` | el comentario lista los métodos del ciclo de vida |
| C3 | `src/modules/budgets/infrastructure/persistence/budget-unit-of-work.impl.ts` | `42-44` | |
| C4 | `src/modules/accounts/infrastructure/persistence/account-unit-of-work.impl.ts` | `40-42` | |
| C5 | `src/modules/auth/infrastructure/persistence/auth-unit-of-work.impl.ts` | `90-92` | |
| C6 | `src/modules/transactions/infrastructure/persistence/__fakes__/in-memory-unit-of-work.ts` | `14`, `25-43` | **también alinea la semántica** — ver §5.4 |
| C7 | `src/modules/auth/infrastructure/persistence/__fakes__/in-memory-auth-unit-of-work.ts` | `14`, `20-38` | ídem |
| C8 | `src/modules/accounts/application/use-cases/archive-account.use-case.spec.ts` | `16` | línea del mock |
| C9 | `src/modules/accounts/application/use-cases/unarchive-account.use-case.spec.ts` | `16` | |
| C10 | `src/modules/accounts/application/use-cases/rename-account.use-case.spec.ts` | `16` | |
| C11 | `src/modules/budgets/application/use-cases/delete-budget.use-case.spec.ts` | `33` | |
| C12 | `src/modules/budgets/application/use-cases/update-budget-limit.use-case.spec.ts` | `40` | |

**Documentación que nombra el método:**

| # | Archivo | Línea(s) |
|---|---|---|
| C13 | `src/modules/transactions/notes.md` | `45` (contrato del ciclo de vida), `137` (fila de la tabla: actualizar también la descripción a *"true entre `begin()` y `release()` — incluido después del commit"*) |
| C14 | `src/shared/domain/uow-decision.md` | `4` |
| C15 | `src/shared/domain/cache-decision.md` | `139` (transcribe la forma del puerto) |
| C16 | `src/PROBLEMS.md` | `160`, `174` |
| C17 | `src/PLAN-P3P4-transactional-runner.md` | **una línea en el encabezado**, no 7 ediciones: *"Nota: `isActive()` se llama `isConnected()` desde P7; todas las menciones de abajo aplican al nombre nuevo."* |

### 5.4 Alineación de los fakes (C6, C7) — el único punto con contenido, no mecánico

Renombrar sin más dejaría a los fakes afirmando `isConnected()` y devolviendo `false` después del
commit: la misma mentira, con otro nombre. Se alinean con los impls:

```diff
-  private active = false;
+  private connected = false;

   async begin(): Promise<void> {
-    this.active = true;
+    this.connected = true;
   }

   async commit(): Promise<void> {
     this._commits++;
-    this.active = false;
   }

   async rollback(): Promise<void> {
     this._rollbacks++;
-    this.active = false;
   }

-  async release(): Promise<void> {}
+  async release(): Promise<void> {
+    this.connected = false;
+  }

-  isActive(): boolean {
-    return this.active;
+  isConnected(): boolean {
+    return this.connected;
   }
```

**Riesgo: cero, verificado.** Ninguna aserción de ningún spec lee el flag — las únicas apariciones
de `isActive` en todo `src/` y `test/` son las 12 de C2-C12, y los helpers que los specs sí asertan
son `commits()` / `rollbacks()`, que no se tocan.

### 5.5 Colisión con P3+P4 — decidida, se documenta

`src/PLAN-P3P4-transactional-runner.md:131-135` **borra** el método (junto con
`begin/commit/rollback/release`) cuando el UoW pase a runner por callback. Entonces este renombre es
trabajo que ese plan eventualmente elimina.

**Se hace igual, por tres razones:** P3+P4 va **cuarto** en el orden sugerido
(`PROBLEMS.md:337`: P7 → P6 → P3+P4 → P5) y es la cirugía más cara y más probable de diferirse; el
renombre es mecánico y verificado por el compilador (riesgo cero); y mientras tanto el nombre es una
trampa activa que ya produjo dos errores (§5.1). Si P3+P4 se ejecuta, el renombre se borra con el
método: costo hundido de una tarde, no rework.

**Lo que este cambio NO hace:** darle un *uso* al método. El guard de reentrada
(`if (this.isConnected()) throw` al inicio de `begin()`, `PROBLEMS.md:174`) pertenece a P4 y queda
fuera de alcance — agregarlo acá crearía un consumidor de un método que P3+P4 planea eliminar.

---

## 6. Tests

### 6.1 El doble — extender el Null Object, local a cada spec

Convención documentada en `src/shared/domain/cache-decision.md:41`: la caché se moquea con
`NullBudgetsCache` (`src/modules/budgets/infrastructure/cache/__fakes__/null-budgets-cache.ts`).
Se extiende en vez de escribir un mock nuevo, y se define **dentro de cada spec** (es un doble de un
caso de prueba, no un fake reutilizable del módulo):

```ts
class ExplodingBudgetsCache extends NullBudgetsCache {
  override async invalidateUser(): Promise<void> {
    throw new Error('redis down');
  }
}
```

Un solo método basta: `Promise.all` rechaza con el primer rechazo.

### 6.2 `delete-budget.use-case.spec.ts` — insertar tras `:103`

Ubicación de la clase: junto a `FakeExpenseChecker` (`:13-23`). Import nuevo: `Logger` de
`@nestjs/common`.

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
  ).resolves.toBeUndefined();                    // la operación reporta éxito

  expect(repo.size()).toBe(0);                   // el efecto de negocio ocurrió
  expect(uow.commit).toHaveBeenCalledTimes(1);
  expect(uow.rollback).not.toHaveBeenCalled();   // ← la aserción central
  expect(uow.release).toHaveBeenCalledTimes(1);  // el finally sigue corriendo
  expect(warn).toHaveBeenCalledTimes(1);         // el fallo queda registrado

  warn.mockRestore();
});
```

### 6.3 `update-budget-limit.use-case.spec.ts` — insertar tras `:106`

Este spec construye `useCase` en `beforeEach` (`:46-49`) con `NullBudgetsCache`, así que el test
nuevo construye su propia instancia:

```ts
it('should NOT roll back nor propagate when cache invalidation fails after commit', async () => {
  budgetRepo.seed([makeBudget({ id: 'b1', userId: 'user-1', limit: 300 })]);
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

  const result = await new UpdateBudgetLimitUseCase(
    mockUow as IBudgetUnitOfWork,
    new ExplodingBudgetsCache(),
  ).execute({ id: 'b1', requestUserId: 'user-1', limit: 800 });

  expect(result.getLimit().getValue()).toBe(800);
  expect(mockUow.commit).toHaveBeenCalledTimes(1);
  expect(mockUow.rollback).not.toHaveBeenCalled();
  expect(mockUow.release).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);

  warn.mockRestore();
});
```

### 6.4 Regresión inversa — 1 línea, barata

En el test existente `'should throw BudgetLimitBelowSpentException when limit is below spent'`
(`update-budget-limit.use-case.spec.ts:87-98`), inyectar un `IBudgetsCache` espiado y agregar:

```ts
expect(cacheSpy.invalidateUser).not.toHaveBeenCalled();
```

Fija la regla que §10.1 explica: **si la transacción aborta, la caché no se toca.**

### 6.5 Rojo antes de verde — y el límite honesto del unitario

Con el código actual, el test de 6.2 falla en **dos** aserciones: `resolves` (la promesa rechaza con
`Error('redis down')`) y `rollback` (se llama una vez, `delete-budget.use-case.ts:58`).

**Lo que el unitario NO reproduce:** el `TransactionNotStartedError`. El mock
`rollback: jest.fn().mockResolvedValue(undefined)` (`delete-budget.use-case.spec.ts:31`) resuelve sin
error, así que el error que se propaga es el de Redis, no el enmascarado. El enmascaramiento requiere
un `QueryRunner` real.

Lo que sí fija son las dos propiedades bajo nuestro control, de las cuales el enmascaramiento es
consecuencia: **(a)** no se llama `rollback()` tras un `commit()` exitoso, **(b)** el fallo de caché
no llega al llamador. Con (a) garantizada, el `TransactionNotStartedError` es inalcanzable por
construcción.

### 6.6 Test de integración — solo para B, y es el que importa

La corrección de B depende de una semántica de TypeORM que **ningún mock puede verificar** y que un
bump mayor podría cambiar en silencio. Con Postgres real, en
`test/integration/concurrency/concurrency.integration.spec.ts` o archivo nuevo:

```
begin() → commit() → rollback()              ⇒ no lanza
begin() → rollback() → rollback()            ⇒ no lanza (sin release en el medio)
begin() → commit() → release()               ⇒ la conexión vuelve al pool
```

**Para A no hace falta integración.** Un equivalente exigiría agregar un hook de `overrideProvider`
a `test/helpers/app-bootstrap.ts:20-45`, que hoy compila `AppModule` sin overrides (`:29-31`) y lo
usan las 9 suites de `test/integration/`. Cambiar un helper compartido por valor marginal sobre el
unitario: mal negocio.

---

## 7. Documentación (commit 4)

| Archivo | Cambio |
|---|---|
| `src/PROBLEMS.md` | P7 → resuelto (o mover a "cerrados"); actualizar la fila de la tabla `:331` y el orden sugerido `:337` |
| `src/modules/budgets/notes.md:68-69` | las descripciones de `UpdateBudgetLimitUseCase` / `DeleteBudgetUseCase` terminan en "commit". Añadir: *"→ invalidación de caché best-effort (fuera del alcance de error de la tx)"* |
| `src/shared/domain/cache-decision.md` §5 (`:261-269`) | regla nueva: **la invalidación va después del commit y su fallo se loguea; nunca se propaga ni dispara rollback** |
| `CLAUDE.md` §"Anti-patterns — do not do" | *"**Do not** put cache invalidation (or any secondary reaction) inside the `try` that a `rollback()` catches. It runs after `commit()`, in its own `try/catch` that only logs."* |

**No hace falta tocar** la tabla excepción→HTTP de `CLAUDE.md`: no se agrega ni se quita ninguna
excepción de dominio.

---

## 8. Secuencia de commits

| # | Mensaje | Alcance | Verde tras |
|---|---|---|---|
| **1** | `fix(budgets): keep cache invalidation out of the transaction's error scope` | A1, A2 + specs A3, A4 | `npm test` — con los 2 tests nuevos **en rojo antes** del cambio |
| **2** | `refactor(shared): guard rollback() against an already-closed transaction` | B1-B4 + test de §6.6 | `npm test` + `npm run test:integration` |
| **3** | `refactor(shared): rename IUnitOfWork.isActive() to isConnected()` | C1-C17 | `npm test` + `npm run test:integration` |
| **4** | `docs: close P7 and record the post-commit rule` | §7 | — |

**Por qué este orden:** el commit 1 es el arreglo y se puede demostrar rojo→verde solo. El 2 es la
red y necesita Postgres. El 3 es renombre puro sin cambio de comportamiento — va último para que se
pueda descartar sin bloquear el arreglo. Cada commit deja el árbol verde y es un estado coherente.

**Recordar:** el compose tiene que estar arriba para los commits 2 y 3
(`test/.env.test` apunta al puerto **5433**; sin él, toda suite de integración falla en el bootstrap
con un error que no se parece a la causa).

---

## 9. Criterios de aceptación

- [ ] `npm test` verde; los 2 tests de §6.2/§6.3 fallan si se revierte A (verificarlo, no asumirlo).
- [ ] `npm run test:integration` verde, incluidas las escenas de
      `concurrency.integration.spec.ts` **sin modificar** (regla de `CLAUDE.md`).
- [ ] `npm run test:cov` — `branches ≥ 70` en `src/modules/**/application/**/*.ts`. Cada `catch`
      nuevo agrega una rama; los tests de §6 la cubren. **Sin esos tests, el umbral puede caer.**
- [ ] `grep -rn "isActive" src/ test/ --include="*.ts"` → **0 resultados**. El filtro por `*.ts` es
      deliberado: C17 escribe la cadena `isActive()` a propósito dentro de los documentos de
      planificación (la nota de `PLAN-P3P4-transactional-runner.md` y la prosa histórica de este
      mismo archivo), que narran el nombre viejo. El criterio es sobre **código**, no sobre prosa.
- [ ] `grep -rn "rollbackTransaction" src/` → 4 apariciones, **las 4 precedidas del guard**.
- [ ] Ningún `catch (cacheError)` vacío: los dos loguean (§10.3).
- [ ] `npm run lint` sin warnings nuevos.

---

## 10. Invariantes — qué NO se toca

### 10.1 Prohibido: invalidar antes del `commit()`

Sería estrictamente peor, por una razón no obvia. Entre la invalidación y el commit se abre una
ventana en la que un `GET /budgets/:id` concurrente encuentra la clave vacía, lee de la DB el estado
**pre-commit** y lo repuebla con `setById` (`get-budget-by-id.use-case.ts:23`) y TTL 600 s
(`budgets-cache.impl.ts:94`). La caché queda envenenada con el valor viejo **y el TTL arranca en ese
momento**: la inconsistencia dura hasta 600 s contados *desde el GET*, no desde el commit. Y si la
transacción aborta, se pagó una invalidación inútil. El orden `commit → invalidación` es correcto.

### 10.2 Prohibido: alterar la semántica transaccional

- No mover, agregar ni quitar `begin()`, `commit()` o `release()`.
- No cambiar el orden de los locks ni las lecturas bajo `FOR UPDATE`
  (`delete-budget.use-case.ts:26,33-40`; `update-budget-limit.use-case.ts:34,42-49`). El mutex lógico
  de la fila de budget queda igual — el arreglo es puramente post-commit.
- No convertir el `catch` externo en algo que trague errores: sigue siendo `rollback(); throw error;`.
- No darle un consumidor a `isConnected()` en este PR (§5.5).

### 10.3 Prohibido: `catch (cacheError) {}` silencioso

Convertiría P7 en un fallo invisible: caché stale sin ninguna señal operativa. La aserción
`expect(warn).toHaveBeenCalledTimes(1)` de §6.2/§6.3 es lo que lo impide.

---

## 11. Fuera de alcance, con destino

| Hallazgo | Por qué queda afuera | Destino |
|---|---|---|
| **Los 6 use cases de escritura sin UoW** (`create-budget:70`, `create-category:36`, `update-category:34-37`, `delete-category:20-23`, `update-user-profile:33`, `delete-user:27`) propagan un fallo de Redis como 500 sobre una escritura ya persistida | No hay transacción, así que no hay enmascaramiento — P7 está definido como *"reacción secundaria dentro del alcance de error de la transacción"*. El síntoma para el cliente **sí** es el mismo | Issue nuevo, sin dependencia con éste. Si se acepta la política de §2.3, aplicarla ahí es el paso lógico siguiente |
| El flag `committed` de `refresh-token.use-case.ts:28,45-46,83-84,87` queda **redundante** una vez aplicado B | `auth` está fuera del alcance de P7 y el flag no es incorrecto, solo innecesario | Limpieza de P3+P4 |
| `release()` que lanza en el `finally` → 500 pese a un commit exitoso, en los 8 use cases | Es el ciclo de vida manual, no la reacción secundaria. A es robusta ante esto (la invalidación ya corrió) | P3+P4 (runner por callback) |
| Circuit breaker / degradación explícita de Redis a nivel `ICacheStore` | No hay evidencia de monitoreo que lo justifique; `CLAUDE.md` §reports ya sentó ese criterio | Diferido |

---

## Apéndice A — Evidencia del barrido de alcance

Tres barridos independientes sobre `src/**/*.ts`; la intersección (1)∩(2) es el conjunto de defectos.

1. `grep -n "\.commit\(\)" -A 12` → qué se ejecuta entre cada `commit()` y su `catch`.
2. `grep -n "this\.cache\." --glob "*.use-case.ts"` → consumidores de un puerto de caché en `application/`.
3. `grep -n "uow\.|unitOfWork\.|\.rollback\(\)"` → archivos con ciclo de vida transaccional manual.

### A.1 Los 8 use cases con UoW

| # | `commit()` en | Qué corre después, dentro del `try` | ¿Puede lanzar? | Veredicto |
|---|---|---|---|---|
| 1 | `create-transaction.use-case.ts:153` | `:154 return saved;` | No | OK |
| 2 | `delete-transaction.use-case.ts:45` | nada (`:46` es el `catch`) | — | OK |
| 3 | `archive-account.use-case.ts:32` | `:33 return saved;` | No | OK |
| 4 | `unarchive-account.use-case.ts:32` | `:33 return saved;` | No | OK |
| 5 | `rename-account.use-case.ts:33` | `:34 return saved;` | No | OK |
| 6 | `refresh-token.use-case.ts:45` y `:83` | `committed = true` + `throw`/`return` | No | OK — ya protegido con flag |
| 7 | **`update-budget-limit.use-case.ts:63`** | **`:65-68` `Promise.all([invalidateUser, invalidateById])`** | **Sí** | **DEFECTO** |
| 8 | **`delete-budget.use-case.ts:51`** | **`:53-56` ídem** | **Sí** | **DEFECTO** |

`return <expr>` con `<expr>` ya evaluada no puede lanzar: no hay getters, ni `toJSON`, ni `await`.
Los casos 1-5 son seguros **por estructura**, no por suerte.

### A.2 Los 13 puntos de caché en `application/` — cuáles están bajo un `catch` con `rollback()`

| Archivo:línea | ¿Bajo `catch` con `rollback()`? |
|---|---|
| `budgets/delete-budget.use-case.ts:54-55` | **SÍ** ← defecto |
| `budgets/update-budget-limit.use-case.ts:66-67` | **SÍ** ← defecto |
| `budgets/create-budget.use-case.ts:70` | No (sin UoW: repo global, `:24`) |
| `budgets/get-budget-by-id.use-case.ts:16,23` · `get-budgets-by-user-id.use-case.ts:20,24` | No (lectura) |
| `categories/create-category:36` · `update-category:35-36` · `delete-category:21-22` | No (sin UoW) |
| `categories/get-category-by-id:16,23` · `get-categories-by-user-id:14,18` | No (lectura) |
| `users/update-user-profile:33` · `delete-user:27` | No (sin UoW) |
| `users/get-user-by-id:25,30` | No (lectura) |

Puertos de caché existentes: `IBudgetsCache`, `ICategoriesCache`, `IUsersCache`. No hay otros —
`src/shared/domain/cache-decision.md:43` lo confirma (`<m>` ∈ { budgets, categories, users }).

**Alcance del defecto: exactamente `delete-budget.use-case.ts` y `update-budget-limit.use-case.ts`.**

### A.3 Apariciones de `isActive` en `src/` y `test/` (12, ninguna en producción)

| Tipo | Ubicaciones |
|---|---|
| Puerto | `shared/domain/IUnitOfWork.ts:20` |
| Impls | `unit-of-work.impl.ts:146` · `budget-unit-of-work.impl.ts:42` · `account-unit-of-work.impl.ts:40` · `auth-unit-of-work.impl.ts:90` |
| Fakes | `in-memory-unit-of-work.ts:41` · `in-memory-auth-unit-of-work.ts:36` |
| Mocks de specs | `archive:16` · `unarchive:16` · `rename:16` · `delete-budget:33` · `update-budget-limit:40` |
| **Llamadas desde código de producción** | **ninguna** |
| **Aserciones que lo lean** | **ninguna** |
