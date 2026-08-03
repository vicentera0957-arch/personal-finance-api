# PLAN P3 + P4 — el UoW como *runner* sin estado

> Referencia: `src/PROBLEMS.md` §P3 y §P4. Plan hermano vivo: `src/PLAN-P7-cache-rollback.md`.
> Este documento no repite los enunciados: aporta **el contrato único**, su aplicación a los cuatro
> impls, el análisis del auto-deadlock y el impacto exacto sobre los 8 use cases y sus specs.
>
> **Supuesto de orden: este plan va DESPUÉS de P1+P2 y DESPUÉS de P7. Las dos condiciones ya se
> cumplen** — P1+P2 cerrado (ver la nota de referencias) y P7 cerrado en `0d3f3d5`. Este plan está
> **desbloqueado**: no espera nada.

> **Decisión de orden respecto de P5 (resuelta, 2026-08-02).** `PROBLEMS.md` registraba una
> discrepancia abierta: `PLAN-P5-narrow-ports.md` §10.3 proponía ir **antes** que P3+P4, y este plan
> asume que P5 sigue diferido. **Se resolvió a favor de este plan: P3+P4 → P5.** El argumento de P5
> §10.3 ("que el contexto del callback nazca con los tipos definitivos") ahorra 3 renglones de firma
> pero ignora que los 7 llamadores que P5 modifica (`PLAN-P5-narrow-ports.md` §4.2) viven en 7 de los
> 8 use cases que **este plan reescribe enteros** (§4.1) — se reescriben exista P5 o no. P5 al final
> toca la forma final una sola vez; P5 al principio ve casi todo su diff re-tocado. P5 §10.3 y la nota
> de `PROBLEMS.md` deben actualizarse en el PR de este plan.
>
> **P6 sigue siendo indiferente a este plan**: sólo decide si `TransactionTxContext` nace con 3 o con
> 4 recursos (§2.2). No bloquea en ninguna dirección.

> **Nota de referencias.** Este plan cita `PLAN-P1P2-accounts.md` y `PLAN-P1P2-budgets.md` con
> números de sección y de línea. Esos archivos ya no existen: el trabajo que describían está
> implementado y se borraron al cerrarse P1 y P2. Las citas se conservan porque el razonamiento
> sigue siendo válido, pero **no las sigas a ciegas** — para el estado real mirá el código, o
> recuperá el texto original con `git show ba62266:src/PLAN-P1P2-budgets.md`.
>
> Commits que cerraron esos planes: `91de97b` · `b026ac8` · `19eed72` (accounts) y
> `83d4c15` · `dc35dc7` · `ac40f03` · `b140cf4` (budgets).
>
> Lo que cambió respecto de lo que este plan asumía: los cuatro impls ya existen y son
> independientes (`TypeOrmUnitOfWorkImpl`, `AccountUnitOfWorkImpl`, `BudgetUnitOfWorkImpl`,
> `AuthUnitOfWorkImpl`), así que la conversión a runner sin estado es **module-local** — se puede
> hacer uno por vez en vez de como big-bang, que es justamente lo que este plan esperaba habilitar.
>
> Nota: `isActive()` se llama `isConnected()` desde P7. Las menciones operativas de abajo ya usan el
> nombre nuevo; las tres que quedan con el viejo son referencias históricas deliberadas al rename.

> **Pasada de drift — 2026-08-02.** Este plan se escribió cuando había **2** impls; hoy hay **4**, y
> P7 movió líneas dentro de los use cases de budgets. Se re-verificaron contra el código y se
> corrigieron: §1.1 (8 apariciones de `Scope.REQUEST`, no 4; las cadenas de contagio ya no cruzan
> módulos), §1.2 (números de línea de los 8 use cases y de `isConnected()` en los 4 impls), §1.3
> (la duplicación es un hecho medido, no una proyección), §3.3 (el guard de P7 ya está en los 4
> impls), §6.2-§6.3 (rangos reales) y §10.1/§10.3 (P1+P2 y P7 cerrados). **Las secciones §2, §4, §5,
> §7, §8 y §9 no se re-verificaron línea por línea** — su razonamiento no depende de los conteos,
> pero sus citas `archivo:línea` a use cases de budgets pueden estar corridas ~20 renglones.

---

## 1. Estado verificado

### 1.1 P3 — dónde vive el `Scope.REQUEST` y hasta dónde llega

**Ocho** apariciones de `Scope.REQUEST` en `src/` — dos por módulo transaccional, el decorador del impl
y el provider (verificado con `grep -rn "Scope.REQUEST" src --include=*.ts`):

| Impl (decorador) | Módulo (provider) |
| --- | --- |
| `transactions/.../unit-of-work.impl.ts:113` | `transactions.module.ts:61` |
| `budgets/.../budget-unit-of-work.impl.ts:12` | `budgets.module.ts:41` |
| `accounts/.../account-unit-of-work.impl.ts:10` | `accounts.module.ts:49` |
| `auth/.../auth-unit-of-work.impl.ts:60` | `auth.module.ts:70` |

La causa raíz es el mismo campo mutable en los cuatro:
`private queryRunner: QueryRunner | null = null` (`unit-of-work.impl.ts:115`,
`budget-unit-of-work.impl.ts:14`, `account-unit-of-work.impl.ts:12`, `auth-unit-of-work.impl.ts:62`).

**Cadena de contagio** (NestJS propaga el scope a todo consumidor, transitivamente). Tras P1+P2 hay
**cuatro cadenas independientes** en vez de dos, y ninguna cruza módulos:

```
TypeOrmUnitOfWorkImpl (REQUEST, unit-of-work.impl.ts:113)
 └─ ITransactionUnitOfWork (useExisting, transactions.module.ts:66-67)
      → CreateTransactionUseCase, DeleteTransactionUseCase        → TransactionsController

BudgetUnitOfWorkImpl (REQUEST, budget-unit-of-work.impl.ts:12)
 └─ IBudgetUnitOfWork (useExisting, budgets.module.ts:43)
      → DeleteBudgetUseCase, UpdateBudgetLimitUseCase             → BudgetsController

AccountUnitOfWorkImpl (REQUEST, account-unit-of-work.impl.ts:10)
 └─ IAccountUnitOfWork (useClass directo, accounts.module.ts:47-49)
      → Archive, Unarchive, Rename                                → AccountsController

AuthUnitOfWorkImpl (REQUEST, auth-unit-of-work.impl.ts:60)
 └─ IAuthUnitOfWork (useExisting, auth.module.ts:72)
      → RefreshTokenUseCase                                       → AuthController
```

> **Detalle a no pasar por alto:** `accounts.module.ts:47-49` es el único que ya bindea el puerto
> **directo** con `useClass` + `scope`, sin el par "clase concreta + `useExisting`". Los otros tres
> conservan el par, que sólo era necesario cuando varios tokens compartían instancia (§6.3). Accounts
> ya tiene la forma final; los otros tres la alcanzan en el commit 7.

Controllers de dominio en el repo (7): accounts, auth, budgets, categories, reports, transactions, users
(+ `app.controller.ts`, `health.controller.ts`, `metrics.controller.ts`). **Cuatro contagiados**
(accounts, auth, budgets, transactions); tres limpios (categories, reports, users). Coincide con
`PROBLEMS.md:122-128`.

**No hay durable providers**: `grep -rn "ContextIdFactory|durable" src test` no devuelve ninguna
ocurrencia de código (sólo prosa en `PROBLEMS.md:127-128`).

> **No verificado:** el costo en latencia. `PROBLEMS.md:122-128` lo describe cualitativamente y es
> correcto en el mecanismo (Nest reconstruye el subárbol de DI por request), pero **no hay ninguna
> medición en el repo** y este plan no la aporta. Si el argumento de venta es rendimiento, hay que
> medirlo antes: `autocannon` sobre `GET /accounts` antes y después. El argumento sólido no es la
> latencia, es P4 (§1.2).

### 1.2 P4 — el ciclo de vida replicado y la ausencia de guarda

El mismo bloque literal en 8 use cases:

| Use case | `begin` | `commit` | `rollback` | `release` |
| --- | --- | --- | --- | --- |
| `create-transaction.use-case.ts` | `:89` | `:153` | `:156` | `:159` |
| `delete-transaction.use-case.ts` | `:23` | `:45` | `:47` | `:53` |
| `archive-account.use-case.ts` | `:18` | `:32` | `:35` | `:38` |
| `unarchive-account.use-case.ts` | `:18` | `:32` | `:35` | `:38` |
| `rename-account.use-case.ts` | `:19` | `:33` | `:36` | `:39` |
| `delete-budget.use-case.ts` | `:21` | `:53` | `:74` | `:77` |
| `update-budget-limit.use-case.ts` | `:29` | `:65` | `:83` | `:86` |
| `refresh-token.use-case.ts` | `:29` | `:45`, `:83` | `:87` | `:90` |

> Los dos de budgets se corrieron ~20 líneas al cerrarse P7: la invalidación de caché pasó a su propio
> `try/catch` post-commit, que se intercala entre el `commit()` y el `rollback()`.

`begin()` pisa el `QueryRunner` anterior sin avisar — mismo cuerpo en los cuatro impls
(`unit-of-work.impl.ts:126`, `budget-unit-of-work.impl.ts:23`, `account-unit-of-work.impl.ts:21`,
`auth-unit-of-work.impl.ts:71`): un doble `begin()` filtra la conexión anterior **permanentemente**
(nadie la libera). Es el único de los cinco métodos que P7 **no** endureció.

`isConnected()` existe en los cuatro impls (`unit-of-work.impl.ts:151`,
`budget-unit-of-work.impl.ts:47`, `account-unit-of-work.impl.ts:45`, `auth-unit-of-work.impl.ts:95`)
y **sigue sin usarse en producción**: sus únicas apariciones fuera de los impls son mocks de specs
(`archive/unarchive/rename-account.use-case.spec.ts:16`, `delete-budget.use-case.spec.ts:40`,
`update-budget-limit.use-case.spec.ts:47`) y los fakes (`in-memory-unit-of-work.ts:41`,
`in-memory-auth-unit-of-work.ts:36`). P7 lo renombró desde `isActive()` y le corrigió la semántica en
los fakes, pero no le dio ningún llamador: este plan lo borra.

**El argumento fuerte de esta cirugía es P4, no P3.** Los 8 bloques son correctos hoy; el noveno es
el riesgo, y un `release()` olvidado no se recupera hasta reiniciar el proceso.

### 1.3 Los cuatro impls actuales son el mismo código

Ya no es una proyección: **la duplicación existe hoy, cuatro veces**. Verificado con `diff` sobre los
bloques del ciclo de vida:

| Impl | Bloque `begin`→`isConnected` | Getters |
| --- | --- | --- |
| `transactions/.../unit-of-work.impl.ts` | `:126-153` | `:155-169` (3) |
| `budgets/.../budget-unit-of-work.impl.ts` | `:23-49` | `:57-64` (2) |
| `accounts/.../account-unit-of-work.impl.ts` | `:21-47` | `:49-52` (1) |
| `auth/.../auth-unit-of-work.impl.ts` | `:71-97` | `:99-105` (1) |

Los cuatro bloques son **byte a byte idénticos** salvo un comentario suelto (`//reserves a connection`,
`unit-of-work.impl.ts:127`) que sólo tiene la copia de transactions. Son **27 renglones replicados
cuatro veces**, y la única diferencia real entre los cuatro impls es qué construyen sus getters.

El cierre de P7 **empeoró** esta métrica de la forma más literal posible: el guard de `rollback()`
—4 renglones de código y 4 de comentario— se escribió cuatro veces, una por impl, porque no hay
ningún lugar donde escribirlo una sola vez. Ésa es exactamente la duplicación que el runner elimina
de raíz, y es el mejor argumento empírico disponible a favor de este plan: la última cirugía sobre
el ciclo de vida costó 4× lo que debería.

---

## 2. El contrato — uno solo

### 2.1 Forma

```ts
// src/shared/domain/IUnitOfWork.ts   (reemplaza el contenido actual)

/**
 * Unidad de trabajo como RUNNER SIN ESTADO.
 *
 * El QueryRunner vive en el stack de la llamada, no en un campo: por eso la
 * implementación puede ser singleton y no contagia Scope.REQUEST (P3), y por eso
 * es imposible olvidar el release() o hacer un doble begin() (P4).
 *
 * `TCtx` es el conjunto de recursos escopados que el módulo expone dentro de la
 * transacción. Es un tipo estructural (no un token de DI), así que puede ser
 * `interface` — misma categoría que los `XCommand` de los use cases
 * (create-transaction.use-case.ts:17, update-budget-limit.use-case.ts:12).
 */
export abstract class IUnitOfWork<TCtx> {
  abstract run<T>(work: (ctx: TCtx) => Promise<T>): Promise<T>;
}
```

Cinco métodos → uno. `begin`, `commit`, `rollback`, `release` e `isConnected` **desaparecen del
puerto**: dejan de ser vocabulario del use case y pasan a ser detalle interno del runner.

> `isConnected()` se borra sin reemplazo. Su única razón de ser prevista era el guard de reentrada de
> `PROBLEMS.md:178` (`if (this.isConnected()) throw` al inicio de `begin()`, listado ahí como
> "endurecimiento inmediato **si se difiere**"); sin `begin()` no hay nada que guardar. La detección
> de reentrada se resuelve en §5, y con mejor alcance.

### 2.2 Cómo se pasan los recursos escopados

Un objeto de contexto, construido **una vez** por `run()`, con propiedades de sólo lectura:

```ts
// src/modules/transactions/domain/ITransactionUnitOfWork.ts
import { IUnitOfWork } from '../../../shared/domain/IUnitOfWork';
import { IScopedTransactionRepository } from './repository/scoped-transaction.repository';
import { IAccountRepository } from '../../accounts/domain/repository/accounts.repository';
import { IBudgetRepository } from '../../budgets/domain/repository/budgets.repository';

export interface TransactionTxContext {
  readonly transactions: IScopedTransactionRepository;
  readonly accounts: IAccountRepository;
  readonly budgets: IBudgetRepository;
}

export abstract class ITransactionUnitOfWork extends IUnitOfWork<TransactionTxContext> {}
```

Decisiones y por qué:

- **Propiedades, no getters.** Hoy cada getter hace `new` en cada llamada
  (`unit-of-work.impl.ts:155-169`); `create-transaction.use-case.ts:92,93,97` llama tres. Con el
  contexto construido una vez, cada scoped se instancia exactamente una vez por transacción. Efecto
  secundario útil: si los scoped llevan guard de precondición (la factory de
  `PLAN-P1P2-budgets.md:110-122`, o el constructor de `PLAN-P1P2-accounts.md:102-115`), el guard
  corre en la construcción del contexto — o sea **una vez, al principio**, no disperso.
- **`interface` y no `abstract class` para `TCtx`.** No viola la regla de CLAUDE.md: esa regla existe
  porque un `interface` no puede ser token de DI. `TransactionTxContext` **nunca se inyecta**; es el
  tipo de un parámetro de callback. Precedente en el repo: `CreateTransactionCommand`
  (`create-transaction.use-case.ts:17`), `UpdateBudgetLimitCommand` (`update-budget-limit.use-case.ts:12`),
  `ArchiveAccountDto` (`archive-account.use-case.ts:7`).
- **El puerto de módulo sigue siendo `abstract class`** y sigue siendo el token de DI. Sin cambios en
  esa regla.
- **Nombres cortos** (`ctx.accounts` en vez de `getScopedAccountRepository()`): el prefijo "Scoped"
  deja de aportar información porque el contexto **sólo existe dentro de `run()`** — no hay forma de
  obtener un repo no escopado desde ahí. El tipo (`IScopedTransactionRepository`) sigue diciéndolo.

Los cuatro contextos:

```ts
// transactions/domain — 3 recursos (4 si P6 mueve el expense checker acá)
interface TransactionTxContext { transactions; accounts; budgets; }
// budgets/domain — 2 recursos
interface BudgetTxContext      { budgets: IBudgetRepository; expenses: IExpenseChecker; }
// accounts/domain — 1 recurso
interface AccountTxContext     { accounts: IAccountRepository; }
// auth/domain — 1 recurso
interface AuthTxContext        { refreshTokens: IRefreshTokenRepository; }
```

**Dónde difieren legítimamente los cuatro: sólo en `TCtx`.** Nada más. El ciclo de vida, la política
de rollback, la propagación de errores y el guard de anidamiento son idénticos porque viven en **una**
clase base (§2.5).

### 2.3 Propagación del valor de retorno

`run<T>` es genérico en el retorno del callback; TypeScript lo infiere:

| Use case | `T` |
| --- | --- |
| `CreateTransactionUseCase` | `Transaction` |
| `UpdateBudgetLimitUseCase` | `Budget` |
| `Archive` / `Unarchive` / `Rename` | `Account` |
| `DeleteTransactionUseCase` | `void` |
| `DeleteBudgetUseCase` | `string` (el `userId` dueño — ver §4) |
| `RefreshTokenUseCase` | una unión discriminada (§2.4.b) |

Esto **elimina** el problema de hoisting que `PLAN-P7-cache-rollback.md:§3 Opción B` tuvo que evitar:
`const ownerId = await this.uow.run(...)` es un `const` normal, sin `let` ni análisis de asignación
definida bajo `strictNullChecks` (`tsconfig.json`).

### 2.4 Propagación de excepciones — regla dura y sus dos casos especiales

**Regla: el runner re-lanza el objeto original, sin envolver.** Los controllers hacen `instanceof`
sobre excepciones de dominio para mapear a HTTP (tabla de `CLAUDE.md` §"Exception → HTTP mapping"),
así que envolver rompería silenciosamente **todas** las respuestas 4xx a la vez. Se protege con un
test dedicado (§7.3).

#### (a) `DeleteTransactionUseCase` traduce dentro del `catch`

Hoy (`delete-transaction.use-case.ts:46-52`):

```ts
} catch (err) {
  await this.uow.rollback();
  if (err instanceof InsufficientFundsException) {
    throw new CannotDeleteTransactionException(id);
  }
  throw err;
}
```

Bajo el runner, la traducción sale del alcance transaccional y queda donde corresponde — es una
decisión del use case, no del ciclo de vida:

```ts
try {
  await this.uow.run(async (ctx) => { /* … */ });
} catch (err) {
  if (err instanceof InsufficientFundsException) {
    throw new CannotDeleteTransactionException(id);
  }
  throw err;
}
```

El rollback ya ocurrió dentro de `run()` antes de re-lanzar. Semántica idéntica; mapeo a 409
(`CannotDeleteTransactionException`) intacto.

#### (b) `RefreshTokenUseCase` **commitea y después lanza** — el caso duro

`refresh-token.use-case.ts:41-48`:

```ts
if (stored.isRevoked()) {
  await repo.revokeFamily(stored.familyId);
  await this.uow.commit();
  committed = true;                                  // ← el flag existe sólo por esto
  throw new RefreshTokenReplayDetectedException();
}
```

La intención: **la revocación de la familia debe persistir aunque la request falle con 401**
(CLAUDE.md §"Flows": *"the commit is intentional: the family must be locked out even if the request
fails"*). Un `run()` ingenuo no puede expresarlo: si el callback lanza, el runner hace rollback y
**deshace la revocación** — una regresión de seguridad silenciosa.

Es la única incompatibilidad real entre el contrato y el código existente, y hay que resolverla
explícitamente.

**R1 — devolver un resultado discriminado y lanzar afuera (recomendada):**

```ts
type RefreshOutcome =
  | { readonly kind: 'rotated'; readonly pair: TokenPair }
  | { readonly kind: 'replay' };

const outcome = await this.uow.run<RefreshOutcome>(async (ctx) => {
  const stored = await ctx.refreshTokens.findByTokenHashWithLock(tokenHash);
  if (!stored) throw new InvalidRefreshTokenException();

  if (stored.isRevoked()) {
    await ctx.refreshTokens.revokeFamily(stored.familyId);
    return { kind: 'replay' };            // ← salida NORMAL ⇒ el runner commitea
  }
  if (stored.isExpired()) throw new RefreshTokenExpiredException();
  /* … rotación … */
  return { kind: 'rotated', pair: { accessToken, refreshToken } };
});

if (outcome.kind === 'replay') throw new RefreshTokenReplayDetectedException();
return outcome.pair;
```

- Cero extensiones al contrato compartido: la excepción de un caso no contamina a los otros tres.
- Es **más honesto** que el flag: hoy el código dice "commiteo y lanzo igual"; ahora dice "revocar la
  familia es un desenlace exitoso de la transacción; el 401 es una decisión posterior".
- El flag `committed` (`:28,46,84,87`) desaparece — deja de existir el hazard que justificaba su
  existencia.
- **Las 7 aserciones del spec sobreviven verbatim**, incluida la crítica
  `expect(uow.commits()).toBe(1)` del caso replay (`refresh-token.use-case.spec.ts:117`): la salida
  es normal, el fake cuenta commit.

**R2 — un sentinel tipo `CommitAndThrow(err)` que el runner reconoce.** Rechazada: mete un concepto
nuevo en el contrato compartido para un único call site, y crea una segunda forma de lanzar.

**R3 — exponer `ctx.commitNow()`.** Rechazada: reintroduce ciclo de vida manual dentro del callback,
que es exactamente lo que P4 elimina, y abre la puerta a "commit a mitad y seguir usando `ctx`".

### 2.5 Una implementación, no cuatro: la clase base

```ts
// src/shared/infrastructure/persistence/typeorm-transaction-runner.ts   (NUEVO)
import { Logger } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { IUnitOfWork } from '../../domain/IUnitOfWork';
import { activeTransaction } from './active-transaction.storage';
import { NestedTransactionError } from './nested-transaction.error';

export abstract class TypeOrmTransactionRunner<TCtx> extends IUnitOfWork<TCtx> {
  private readonly logger = new Logger(TypeOrmTransactionRunner.name);

  protected constructor(private readonly dataSource: DataSource) {
    super();
  }

  /** Único punto de variación entre los cuatro módulos. */
  protected abstract createContext(queryRunner: QueryRunner): TCtx;

  async run<T>(work: (ctx: TCtx) => Promise<T>): Promise<T> {
    const outer = activeTransaction.getStore();
    if (outer) throw new NestedTransactionError(outer.owner, this.constructor.name);

    const qr: QueryRunner = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    return activeTransaction.run({ owner: this.constructor.name }, async () => {
      try {
        const result = await work(this.createContext(qr));
        await qr.commitTransaction();
        return result;
      } catch (err) {
        // El error del rollback NUNCA debe enmascarar el error original (§3).
        try {
          if (qr.isTransactionActive) await qr.rollbackTransaction();
        } catch (rollbackErr) {
          this.logger.error(
            `Rollback falló tras un error en ${this.constructor.name}.run(); ` +
              `se propaga el error original. Causa del rollback: ${(rollbackErr as Error).message}`,
          );
        }
        throw err;                       // ← objeto original, sin envolver
      } finally {
        await qr.release();              // ← imposible de olvidar
      }
    });
  }
}
```

Cada módulo aporta ~12 líneas:

```ts
// accounts/infrastructure/persistence/account-unit-of-work.impl.ts
@Injectable()                                             // ← singleton, sin Scope.REQUEST
export class AccountUnitOfWorkImpl
  extends TypeOrmTransactionRunner<AccountTxContext>
  implements IAccountUnitOfWork
{
  constructor(dataSource: DataSource, private readonly mapper: AccountMapper) {
    super(dataSource);
  }
  protected createContext(qr: QueryRunner): AccountTxContext {
    return { accounts: new ScopedAccountRepository(qr.manager, this.mapper) };
  }
}
```

**Nota de tipos:** el impl ya no puede `extends` su puerto (extiende el runner), así que usa
`implements IAccountUnitOfWork`. Es válido —el puerto es `abstract class` sin miembros propios más
allá de `run`— y hay precedente en el repo: `TypeOrmUnitOfWorkImpl` ya hace
`implements IBudgetUnitOfWork, IAccountUnitOfWork` (`unit-of-work.impl.ts:255-258`). El binding de DI
pasa a `{ provide: IAccountUnitOfWork, useClass: AccountUnitOfWorkImpl }` — `useClass` no exige
herencia del token.

**Consecuencia menor a registrar:** al vaciarse los puertos de miembros propios, dos puertos con
`TCtx` estructuralmente compatibles se vuelven mutuamente asignables por tipo. No es un problema
práctico (la resolución de DI es por token, no por forma), pero conviene saberlo antes de que alguien
lo descubra en un error confuso.

---

## 3. Qué pasa con el endurecimiento de `rollback()` de P7

**Respuesta corta: el runner vuelve inalcanzable el hazard que P7 encontró, y la guarda cambia de
naturaleza — de arreglo necesario a defensa barata.**

### 3.1 El hazard de P7 desaparece por construcción

P7 (`PLAN-P7-cache-rollback.md:§1.2`) es: *código de usuario después del `commit()` pero dentro del
`try` que un `catch` con `rollback()` cubre*. Bajo el runner **no existe ese lugar**: entre
`await qr.commitTransaction()` y el `catch` no hay nada que el use case pueda escribir. Todo lo que
el use case ponga después de `await this.uow.run(...)` está, por construcción, fuera de cualquier
alcance de rollback.

Esto es **estrictamente mejor** que el arreglo que planifiqué en P7. Aquella Opción A dejaba la
invalidación léxicamente dentro del `try` externo y su garantía era "no puede lanzar" —yo mismo la
marqué como debilidad (`PLAN-P7-cache-rollback.md:§3, "Contra"`), porque un `await` agregado después
reabría el agujero. El runner elimina la categoría entera.

### 3.2 ¿Sobrevive el arreglo de P7 al cambio de forma? Sí, y se simplifica

Bajo el runner, `DeleteBudgetUseCase` queda (ver §4 el antes/después completo):

```ts
const ownerId = await this.uow.run(async (ctx) => { /* … */ return budget.userId; });

try {
  await Promise.all([this.cache.invalidateUser(ownerId), this.cache.invalidateById(id)]);
} catch (cacheError) {
  this.logger.warn(`…`);
}
```

Se conservan las tres propiedades que P7 exige: orden `commit → invalidación`, el fallo de caché no
provoca rollback, y el fallo queda logueado. Se pierde una complicación: ya no hace falta el `try`
anidado. **Los dos tests unitarios que P7 agrega siguen siendo válidos y siguen fallando en rojo si
alguien mete la invalidación dentro del callback** (ahí sí volvería a disparar rollback).

### 3.3 ¿Sigue haciendo falta el guard de `isTransactionActive`?

Análisis de los caminos por los que `rollbackTransaction()` puede ejecutarse sin transacción abierta,
sobre `node_modules/typeorm/driver/postgres/PostgresQueryRunner.js` (TypeORM 0.3.28):

| Camino | `isTransactionActive` al llegar al rollback | ¿Lo cubre el guard? |
| --- | --- | --- |
| `work(ctx)` lanza | `true` | no aplica (rollback correcto) |
| `commitTransaction()` lanza en el chequeo inicial (`:137-138`) | imposible: acabamos de hacer `startTransaction()` | — |
| `broadcast("BeforeTransactionCommit")` lanza (`:139`) | `true` | no aplica |
| `query("COMMIT")` lanza (`:144`) | `true` (`:145` no se alcanza) | **no** — el guard no ayuda; el rollback se intenta sobre una conexión posiblemente rota |
| `broadcast("AfterTransactionCommit")` lanza (`:148`) | `false` (`:145` ya corrió) | **sí** — sin guard, `TransactionNotStartedError` (`:156-157`) enmascara el error real |

El único camino que el guard cubre exige un **subscriber de TypeORM**, y el proyecto no tiene ninguno:
`grep -rn "EventSubscriber|subscribers" src` no devuelve nada, `src/data-source.ts:54-55` sólo declara
`entities` y `migrations`, y `app.module.ts:103-136` no pasa `subscribers`. **Hoy ese camino es
inalcanzable.**

**Recomendación: el guard correcto no es `isTransactionActive` sino el `try/catch` alrededor del
rollback** (§2.5), porque cubre además el caso `query("COMMIT")` lanza, que es el único de los cinco
con probabilidad no despreciable (caída de red durante el COMMIT). Mantengo `if (qr.isTransactionActive)`
como cortocircuito barato —evita ruido de log en el camino del broadcaster— pero **la garantía la da
el `catch`, no el flag**.

Economía del cambio: el endurecimiento **ya costó** 4 duplicaciones — P7 escribió el guard
`if (!this.queryRunner?.isTransactionActive) return;` cuatro veces, una por impl
(`unit-of-work.impl.ts:137`, `budget-unit-of-work.impl.ts:33`, `account-unit-of-work.impl.ts:31`,
`auth-unit-of-work.impl.ts:81`), cada una con su bloque de 4 líneas de comentario. Bajo el runner
cuesta **6 líneas, una sola vez**. La relación costo/beneficio se invierte a favor de aplicarlo aunque
el camino sea estrecho.

> **Consecuencia para la secuencia (ya no hipotética):** P7 está aplicado, así que sus ediciones de
> `rollback()` en los 4 impls **se borran** en el commit 7 junto con el resto del ciclo de vida
> manual. No hay conflicto y no hay trabajo repetido: lo que P7 dejó es el paso intermedio correcto,
> y su intención sobrevive mejor implementada en el `try/catch` del runner. Ver §10.
>
> **Qué pasa con el spec que P7 agregó.** `test/integration/concurrency/rollback-guard.integration.spec.ts`
> prueba `begin→commit→rollback` y `begin→rollback→rollback` sobre los 4 impls con un `QueryRunner`
> real. Ese contrato **deja de existir** cuando se borra el ciclo de vida manual: no hay `rollback()`
> público que llamar. El spec no se "adapta" — se **reemplaza** por el equivalente sobre `run()`
> (§7.3), que es donde vive la misma garantía. Borrarlo sin reemplazo sería perder cobertura sobre la
> semántica de TypeORM que motivó P7; hay que decirlo explícito en el commit 7 para que nadie lo
> interprete como "el test estorbaba".

---

## 4. Los 8 use cases y sus specs

### 4.1 Impacto por archivo

| Use case | Cambio | Riesgo |
| --- | --- | --- |
| `create-transaction.use-case.ts:88-161` | envolver el bloque; `getScopedX()` → `ctx.x`; `return saved` pasa a ser el retorno del callback | bajo |
| `delete-transaction.use-case.ts:22-54` | ídem + mover la traducción `InsufficientFunds → CannotDelete` fuera de `run()` (§2.4.a) | **medio** — es el único con lógica en el `catch` |
| `archive-account.use-case.ts:17-39` | envolver; `ctx.accounts` | bajo |
| `unarchive-account.use-case.ts:17-39` | ídem | bajo |
| `rename-account.use-case.ts:18-40` | ídem | bajo |
| `delete-budget.use-case.ts:18-62` | envolver; el callback devuelve `budget.userId`; la invalidación de caché queda después de `run()` | bajo (§3.2) |
| `update-budget-limit.use-case.ts:26-75` | ídem; el callback devuelve `updated` | bajo |
| `refresh-token.use-case.ts:28-91` | **reestructurar** con la unión discriminada (§2.4.b); borrar el flag `committed` | **alto** — toca replay detection |

`UpdateAccountBalanceUseCase` (`update-account-balance.use-case.ts`) **no cambia**: sigue recibiendo
un `IAccountRepository`; en `create-transaction.use-case.ts:94` y `delete-transaction.use-case.ts:35`
pasa a construirse con `new UpdateAccountBalanceUseCase(ctx.accounts)`.

### 4.2 Antes / después — `DeleteBudgetUseCase` (representativo: lleva P7 y devuelve un valor)

**Antes** (`delete-budget.use-case.ts:17-63`, estado post-P7 según `PLAN-P7-cache-rollback.md:§5.1`):

```ts
async execute(id: string, requestUserId: string): Promise<void> {
  await this.uow.begin();
  try {
    const budgetRepo = this.uow.getScopedBudgetRepository();
    const budget = await budgetRepo.findById(id);                    // FOR UPDATE
    if (!budget) throw new BudgetNotFoundException(id);
    if (budget.userId !== requestUserId) throw new ResourceOwnershipException(id);

    const hasExpenses = await this.uow
      .getScopedExpenseChecker()
      .hasExpensesInPeriod(budget.userId, budget.categoryId, budget.month, budget.year);
    if (hasExpenses) throw new BudgetHasTransactionsInPeriodException(id, budget.month, budget.year);

    await budgetRepo.delete(id);
    await this.uow.commit();

    try {                                                            // ← anidado (P7)
      await Promise.all([
        this.cache.invalidateUser(budget.userId),
        this.cache.invalidateById(id),
      ]);
    } catch (cacheError) { this.logger.warn(`…`); }
  } catch (error) {
    await this.uow.rollback();
    throw error;
  } finally {
    await this.uow.release();
  }
}
```

**Después:**

```ts
async execute(id: string, requestUserId: string): Promise<void> {
  // Todo lo transaccional adentro. El commit lo hace el runner al salir sin excepción.
  const ownerId = await this.uow.run(async (ctx) => {
    // LOCK (FOR UPDATE): fila de budget. El lock vive en el repo escopado, igual que antes.
    // Es la compuerta de serialización del invariante de período (cierra la Race 1).
    const budget = await ctx.budgets.findById(id);
    if (!budget) throw new BudgetNotFoundException(id);
    if (budget.userId !== requestUserId) throw new ResourceOwnershipException(id);

    // NO LOCK: agregado (Postgres prohíbe FOR UPDATE sobre COUNT). Consistente sólo
    // porque la fila de budget de arriba está bloqueada.
    const hasExpenses = await ctx.expenses.hasExpensesInPeriod(
      budget.userId, budget.categoryId, budget.month, budget.year,
    );
    if (hasExpenses) {
      throw new BudgetHasTransactionsInPeriodException(id, budget.month, budget.year);
    }

    await ctx.budgets.delete(id);
    return budget.userId;
  });

  // POST-COMMIT por construcción: fuera de run() no hay ningún alcance de rollback.
  try {
    await Promise.all([
      this.cache.invalidateUser(ownerId),
      this.cache.invalidateById(id),
    ]);
  } catch (cacheError) {
    this.logger.warn(
      `Budget ${id} borrado y commiteado, pero falló la invalidación de caché ` +
        `(user ${ownerId}). Lecturas stale hasta el TTL. Causa: ${(cacheError as Error).message}`,
    );
  }
}
```

De 46 líneas con tres niveles de anidamiento a 30 con dos. Desaparecen `begin`, `commit`, `rollback`,
`release` y el `try` anidado; los comentarios de lock —el activo documental del repo— viajan intactos.

### 4.3 Los specs: la forma del mock nuevo

Hay **dos** estilos de doble en el repo y los dos se preservan.

#### Estilo A — fakes in-memory con contadores (3 specs)

`in-memory-unit-of-work.ts:25-43` y `in-memory-auth-unit-of-work.ts:20-42` implementan el ciclo de
vida y cuentan. Bajo el runner el fake **mueve los contadores adentro de `run()`**:

```ts
// in-memory-unit-of-work.ts  (después)
async run<T>(work: (ctx: TransactionTxContext) => Promise<T>): Promise<T> {
  this.active = true;
  try {
    const result = await work({
      transactions: this.txRepo,
      accounts: this.acctRepo,
      budgets: this.budgetRepo ?? throwMissing('BudgetRepository'),
    });
    this._commits++;
    return result;
  } catch (err) {
    this._rollbacks++;
    throw err;
  } finally {
    this.active = false;
  }
}
```

**Las 13 aserciones de estos 3 specs sobreviven verbatim** — `commits()` / `rollbacks()` siguen
existiendo con la misma semántica:

- `create-transaction.use-case.spec.ts:114,115,209,210`
- `delete-transaction.use-case.spec.ts:57,109`
- `refresh-token.use-case.spec.ts:75,76,98,117,137,149,150`

Cambios reales en estos specs: **ninguno**, salvo que `create-transaction.use-case.spec.ts:41`
(`new InMemoryUnitOfWork(txRepo, accountRepo, budgetRepo)`) y
`delete-transaction.use-case.spec.ts:25` mantienen su firma. `refresh-token.use-case.spec.ts:45`
tampoco cambia.

> Detalle importante: el lanzamiento diferido de `getScopedBudgetRepository()`
> (`in-memory-unit-of-work.ts:53-58`, *"BudgetRepository not provided"*) pasa a evaluarse al
> **construir** el contexto, no al pedirlo. `delete-transaction.use-case.spec.ts:25` construye el fake
> sin `budgetRepo` y hoy funciona porque `DeleteTransaction` nunca llama a ese getter. Si el contexto
> se construyera eager con un throw, ese spec rompería. **Solución: en el fake, exponer las
> propiedades faltantes como getters con `Object.defineProperty` o construir el contexto con
> `get budgets() { … }`** — un objeto literal con getter es válido para el `interface` y preserva la
> semántica perezosa. Es el único ajuste no mecánico de los fakes.

#### Estilo B — mock literal con `jest.fn()` (5 specs)

`archive/unarchive/rename-account.use-case.spec.ts:11-18` y
`delete-budget.use-case.spec.ts:25-38`, `update-budget-limit.use-case.spec.ts:35-45` mockean los cinco
métodos. Reemplazo que **preserva todas las sondas existentes**:

```ts
// archive-account.use-case.spec.ts  (después)
const makeMockUow = (repo: InMemoryAccountRepository) => {
  const commit = jest.fn();
  const rollback = jest.fn();
  const release = jest.fn();
  return {
    commit, rollback, release,                       // ← siguen siendo observables
    run: jest.fn(async (work: (ctx: AccountTxContext) => Promise<unknown>) => {
      try {
        const result = await work({ accounts: repo });
        commit();
        return result;
      } catch (err) {
        rollback();
        throw err;
      } finally {
        release();
      }
    }),
  };
};
```

Con esto, **las 24 aserciones de los 5 specs pasan sin tocarse**:

- `archive-account.use-case.spec.ts:39,40,54,55,68,82`
- `unarchive-account.use-case.spec.ts:39,40,56,57,72,88`
- `rename-account.use-case.spec.ts:40,41,56,57,71,86`
- `delete-budget.use-case.spec.ts:57,58,73,74,87,102`
- `update-budget-limit.use-case.spec.ts:63,64,74,84,97,105`

Único borrado: la línea `isConnected: jest.fn().mockReturnValue(true)` en los 5 mocks
(`archive:16`, `unarchive:16`, `rename:16`, `delete-budget:40`, `update-budget-limit:47`) — el método
ya no existe en el puerto. Ninguna aserción la usa.

**Éste es el criterio de corrección del refactor: si hay que reescribir aserciones, algo se salió de
"cambio de forma" a "cambio de comportamiento".** Sólo cambian los constructores de dobles.

---

## 5. El auto-deadlock: ¿se puede volver imposible?

### 5.1 El riesgo, con precisión

`PLAN-P1P2-budgets.md:483-489` lo enuncia: hoy el `useExisting` de `transactions.module.ts:63-74`
garantiza que los tres tokens resuelven a **una** instancia por request → un `QueryRunner`. Tras el
split serían instancias distintas → dos transacciones en el mismo request. Si TX_A tiene `FOR UPDATE`
sobre una fila y TX_B la pide dentro de la misma cadena de `await`, **nadie puede avanzar**: Postgres
no lo ve como deadlock (no hay ciclo entre dos backends que esperen mutuamente — B espera a A, y A
espera a que el proceso Node continúe, cosa que no pasará). Se resuelve por `lock_timeout` /
`statement_timeout` si están configurados, o cuelga. Además quema 2 de `DB_POOL_MAX`
(`app.module.ts:129`, default 10).

**Hoy no ocurre**: verificado en `PLAN-P1P2-budgets.md:48-59` — ningún use case inyecta dos puertos de
UoW (`create-transaction:30`, `delete-transaction:14`, `delete-budget:13`, `update-budget-limit:21`,
`archive:14`, `unarchive:14`, `rename:15`, `refresh-token:20`).

### 5.2 El runner **empeora** el riesgo antes de mejorarlo — hay que decirlo

Un runner sin estado es reentrante por defecto: cada `run()` crea su propio `QueryRunner` en el stack.
Eso mata el bug de "doble `begin()` pisa el anterior" (P4), pero habilita uno nuevo:

```ts
await this.uow.run(async () => {
  await this.uow.run(async () => { … });   // dos transacciones, un solo puerto
});
```

Hoy eso es imposible de escribir sin que el `release()` interno rompa el externo, así que la forma
actual "protege" por accidente. **Con el runner, el anidamiento pasa de ruidoso a silencioso.** Ese es
el argumento decisivo para incorporar un detector: no es paranoia sobre P1/P2, es cerrar un agujero
que esta misma cirugía abre.

### 5.3 La respuesta: `AsyncLocalStorage` como **detector**, nunca como propagador

```ts
// src/shared/infrastructure/persistence/active-transaction.storage.ts   (NUEVO)
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Marca de "ya hay una transacción abierta en esta cadena async".
 *
 * ⚠ REGLA: este store lleva SÓLO el nombre del dueño, para diagnóstico. NUNCA debe
 * llevar un EntityManager, un QueryRunner ni un repositorio. El contexto transaccional
 * se pasa EXPLÍCITAMENTE por el parámetro `ctx` de run(). Poner recursos acá convierte
 * este mecanismo en la propagación implícita que PROBLEMS.md:365-369 rechaza.
 */
export interface ActiveTransactionMark { readonly owner: string; }
export const activeTransaction = new AsyncLocalStorage<ActiveTransactionMark>();
```

`PROBLEMS.md:365-369` descarta `AsyncLocalStorage` — y con razón — **para propagar el contexto
transaccional**: *"volviendo implícito el mecanismo más delicado del sistema… cambiar explícito por
implícito es un retroceso de legibilidad"*. Ese argumento **no aplica** a este uso: el contexto sigue
viajando explícito por `ctx`; el ALS lleva un string y su único efecto es lanzar. Nada se vuelve
implícito; se agrega una comprobación. Es una distinción real, no un rodeo — pero conviene escribirla
en CLAUDE.md junto al store, porque la próxima persona que lea `AsyncLocalStorage` en este repo va a
buscar la contradicción.

**Precedente de que el mecanismo funciona en este proceso:** `nestjs-pino` ya usa un
`AsyncLocalStorage` (`node_modules/nestjs-pino/storage.js`) y de ahí sale el `reqId` que
`PinoLogger.logger` resuelve (`node_modules/nestjs-pino/PinoLogger.js:60-63`). Node 20
(`package.json:34`, `"node": ">=20 <21"`).

**Qué detecta y qué no:**

| Escenario | ¿Lo detecta? | Comentario |
| --- | --- | --- |
| `uowA.run(… await uowB.run(…) …)` — el auto-deadlock de `PLAN-P1P2-budgets.md:483` | **Sí**, en la primera ejecución | Es exactamente el caso peligroso |
| `uow.run(… await uow.run(…) …)` — anidamiento del mismo puerto (§5.2) | **Sí** | El agujero que abre el runner |
| `await uowA.run(…)` **seguido de** `await uowB.run(…)` (secuencial) | No, y correcto | El scope del ALS ya salió; son dos transacciones independientes, patrón legítimo |
| `Promise.all([uowA.run(…), uowB.run(…)])` — hermanas concurrentes | **No** | Ambas arrancan fuera de todo store. Quema 2 slots del pool y puede deadlockear entre sí, pero ahí **sí** hay ciclo entre dos backends y Postgres lo aborta con `40P01`. Limitación honesta del detector |
| Dos requests concurrentes | No, y correcto | ALS es por cadena async, no global |

**Complemento estático opcional (regla de lint):** una regla local que prohíba más de un parámetro de
constructor cuyo tipo termine en `UnitOfWork` atraparía el caso léxico en tiempo de escritura.
`eslint.config.mjs` es flat config sin reglas propias hoy; agregar una implica crear un plugin local.
**No lo recomiendo en este PR** — el detector de runtime cubre el caso y la regla puede venir después
si aparece un segundo incidente. Lo dejo anotado, no propuesto.

**Complemento documental (sí, en este PR):** anti-patrón en CLAUDE.md — *"un use case inyecta como
máximo un puerto de UoW. Si necesita coordinar dos agregados, el UoW dueño de la frontera
multi-agregado (`transactions`) compone los recursos escopados de los vecinos."* Es la regla que la
arquitectura ya afirma (`PROBLEMS.md:16-26`); el ALS sólo la hace verificable.

**Respuesta directa a la pregunta:** *imposible por construcción*, no — TypeScript no puede impedir
que alguien inyecte dos puertos. *Detectable de forma determinista y en la primera ejecución del
camino*, sí, con ~10 líneas y sin volver implícito nada. Es la mejor garantía disponible sin adoptar
la propagación implícita que el inventario ya rechazó.

---

## 6. Cambios archivo por archivo

### 6.1 Nuevos (4)

| Archivo | Contenido |
| --- | --- |
| `src/shared/infrastructure/persistence/typeorm-transaction-runner.ts` | la clase base de §2.5 (directorio nuevo: hoy `src/shared/infrastructure/` sólo tiene `cache/`, `health/`, `metrics/`) |
| `src/shared/infrastructure/persistence/active-transaction.storage.ts` | el ALS de §5.3 |
| `src/shared/infrastructure/persistence/nested-transaction.error.ts` | `NestedTransactionError extends Error` |
| `src/shared/infrastructure/persistence/typeorm-transaction-runner.spec.ts` | tests del runner (§7.3) |

### 6.2 Reescritos

| Archivo | Cambio |
| --- | --- |
| `src/shared/domain/IUnitOfWork.ts` | 5 métodos → `run<T>`; genérico en `TCtx` |
| `transactions/domain/ITransactionUnitOfWork.ts:18-22` | + `TransactionTxContext`; el cuerpo de la clase queda vacío |
| `budgets/domain/IBudgetUnitOfWork.ts:5-8` | + `BudgetTxContext`; ídem |
| `accounts/domain/IAccountUnitOfWork.ts:4-6` | + `AccountTxContext`; ídem |
| `auth/domain/IAuthUnitOfWork.ts:9-11` | + `AuthTxContext`; ídem |
| `transactions/.../unit-of-work.impl.ts:113-169` | `extends TypeOrmTransactionRunner<TransactionTxContext>`; borrar `:115` (campo), `:125-153` (ciclo de vida), `:155-169` (3 getters) → `createContext()` |
| `budgets/.../budget-unit-of-work.impl.ts:12-64` | ídem; borrar `:14`, `:23-49`, `:57-64` (2 getters) |
| `accounts/.../account-unit-of-work.impl.ts:10-52` | ídem; borrar `:12`, `:21-47`, `:49-52` (1 getter) |
| `auth/.../auth-unit-of-work.impl.ts:60-105` | ídem; borrar `:62`, `:71-97`, `:99-105` (1 getter) |

Los cuatro bloques de ciclo de vida son idénticos (§1.3), así que las cuatro ediciones son la misma:
**borrar 27 renglones y aportar un `createContext()`**. El impl más grande queda en ~12 líneas.

### 6.3 Módulos (4) — quitar `Scope.REQUEST`

| Archivo | Cambio |
| --- | --- |
| `transactions.module.ts:59-67` | borrar `scope: Scope.REQUEST` (`:61`); colapsar el par a `{ provide: ITransactionUnitOfWork, useClass: TypeOrmUnitOfWorkImpl }`; borrar `Scope` del import |
| `budgets.module.ts:39-43` | ídem → `{ provide: IBudgetUnitOfWork, useClass: BudgetUnitOfWorkImpl }` |
| `auth.module.ts:68-72` | ídem → `{ provide: IAuthUnitOfWork, useClass: AuthUnitOfWorkImpl }` |
| `accounts.module.ts:47-49` | **sólo** borrar `scope: Scope.REQUEST` (`:49`) y el import. Ya bindea el puerto directo con `useClass`: no hay par que colapsar |

Nota: el par "clase concreta + `useExisting` al puerto" sólo era necesario para que **varios** tokens
compartieran instancia. Tras P1/P2 cada impl sirve un único token, así que un `useClass` basta — y
`accounts` ya lo hace así, lo que sirve de referencia de la forma final para los otros tres.

> **El token concreto se puede borrar — verificado, no asumido.** En `transactions`, `budgets` y
> `auth` la clase concreta es hoy un token de DI provisto explícitamente; al colapsar el par,
> desaparece. `transactions.module.ts:59` **afirma** en un comentario que nunca se usa directo; se
> comprobó que es cierto para los cuatro:
> `grep -rn "TypeOrmUnitOfWorkImpl\|BudgetUnitOfWorkImpl\|AuthUnitOfWorkImpl\|AccountUnitOfWorkImpl" src --include=*.ts`
> devuelve sólo los propios impls, sus módulos y comentarios en prosa. **Ningún use case ni provider
> inyecta la clase concreta.** Re-correrlo antes del commit 7 igual, por si algo entró en el medio.

### 6.4 Use cases (8) y specs (8)

Ver §4. Los fakes `in-memory-unit-of-work.ts:8-74` e `in-memory-auth-unit-of-work.ts:11-52` también.

### 6.5 Documentación (mismo PR)

| Archivo | Qué corregir |
| --- | --- |
| `CLAUDE.md` §"Concurrency: Unit of Work + pessimistic locks" | el snippet de `useExisting`, la tabla de puertos, "Scoped resources" (pasan a ser propiedades del contexto) |
| `CLAUDE.md` §"Anti-patterns" | + "un use case inyecta como máximo un puerto de UoW" (§5.3); + "el store de `activeTransaction` nunca lleva recursos". Y **revisar el anti-patrón que agregó P7** ("no poner invalidación de caché dentro del `try` que cubre un `rollback()`"): bajo el runner ese lugar deja de existir (§3.1), así que la regla pasa de "no lo hagas" a "no podés hacerlo" — reformular, no borrar |
| `src/shared/domain/uow-decision.md:4,13-21` | `:4` enumera el ciclo de vida (`begin, commit, rollback, release, isConnected`) → pasa a `run`. `:13` ("One implementation per transactional boundary") **ya está correcto** tras P1+P2 y sigue siéndolo; lo que cambia es que las cuatro impls dejan de duplicar el ciclo. `:30` describe el bloque `begin() → … → release() en finally` que este plan elimina |
| `src/PROBLEMS.md` §P3 (`:103-144`) y §P4 (`:147-179`) | marcar como resueltos siguiendo el patrón de la nota de cabecera (`:10-16`); actualizar la tabla `:293-298`, el mapa `:283-288` y el orden sugerido `:300`; **cerrar la discrepancia `:306-308`** (ver la nota de orden en la cabecera de este plan) |
| `src/modules/transactions/notes.md:45,137` | `:45` enumera el contrato del ciclo de vida; `:137` documenta `isConnected()` con su semántica — ambas desaparecen |
| `src/shared/domain/cache-decision.md:139` | cita `abstract isConnected(): boolean` dentro de un snippet del puerto |
| `src/modules/accounts/notes.md`, `src/modules/budgets/notes.md` | el contrato del ciclo de vida donde lo mencionen |
| `docs/architecture.md`, `docs/concurrency-model.md` | los planes hermanos ya listaban las líneas (`PLAN-P1P2-accounts.md:372-377`, `PLAN-P1P2-budgets.md:333-347`, hoy sólo accesibles vía `git show`); se re-tocan las mismas |
| `test/integration/concurrency/rollback-guard.integration.spec.ts` | **se reemplaza**, no se adapta (§3.3) |

---

## 7. Verificación

### 7.1 Que `Scope.REQUEST` desapareció — comprobación estructural

```bash
grep -rn "Scope\." src --include=*.ts     # → 0 resultados
```

Hoy da exactamente 4 (§1.1). Es necesario pero no suficiente: no prueba que Nest realmente instancie
los controllers una sola vez.

### 7.2 Que `Scope.REQUEST` desapareció — comprobación de DI (la que vale)

`AbstractInstanceResolver.find()` (`node_modules/@nestjs/core/injector/abstract-instance-resolver.js:10-14`)
lanza `InvalidClassScopeException` cuando
`wrapperRef.scope === Scope.REQUEST || Scope.TRANSIENT || !wrapperRef.isDependencyTreeStatic()`.

La tercera condición es la clave: **`isDependencyTreeStatic()` es falsa para cualquier provider
contagiado transitivamente**, aunque su propio `scope` sea `DEFAULT`. O sea, `app.get(X)` es una sonda
exacta de "X y todo su subárbol son singleton".

Test de integración propuesto — `test/integration/di-scope.integration.spec.ts` (nuevo):

```ts
it('ningún controller de dominio es request-scoped', async () => {
  const app = await createTestApp();
  for (const C of [AccountsController, AuthController, BudgetsController,
                   TransactionsController, CategoriesController, UserController,
                   ReportsController]) {
    expect(() => app.get(C)).not.toThrow();          // hoy los 4 primeros TIRAN
  }
  // Identidad de singleton: dos resoluciones, la misma instancia.
  expect(app.get(BudgetsController)).toBe(app.get(BudgetsController));
  await app.close();
});
```

**Es el test que protege contra el regreso**: si alguien reintroduce `Scope.REQUEST` en cualquier
punto del subárbol —no sólo en el UoW— `app.get()` vuelve a tirar y el test se pone rojo, señalando el
controller exacto. Un `grep` no puede hacer eso (no ve el contagio transitivo).

Va en `test/integration/` y no en unit tests porque necesita el `AppModule` real
(`test/helpers/app-bootstrap.ts:20-45`), que a su vez requiere Postgres y Redis.

### 7.3 Tests del runner (unitarios, sin DB)

`src/shared/infrastructure/persistence/typeorm-transaction-runner.spec.ts`, con un `DataSource`
mockeado que devuelve un `QueryRunner` de `jest.fn()`s:

| Caso | Aserción |
| --- | --- |
| camino feliz | `startTransaction` → `work` → `commitTransaction` → `release`, en ese orden; `rollbackTransaction` no llamado |
| el callback lanza | `rollbackTransaction` llamado, `commitTransaction` no, `release` sí |
| **la excepción llega intacta** | `await expect(run(() => { throw new BudgetNotFoundException('b1'); })).rejects.toBeInstanceOf(BudgetNotFoundException)` — protege el `instanceof` de todos los controllers |
| el valor de retorno se propaga | `await run(async () => 42)` → `42` |
| `release()` siempre corre | también cuando `commitTransaction` lanza |
| el rollback que falla no enmascara | `rollbackTransaction` rechaza → la promesa rechaza con el error **original** (§3.3) |
| anidamiento | `run(() => run(() => …))` → `NestedTransactionError`; el `QueryRunner` interno **nunca se crea** (`createQueryRunner` llamado una sola vez) |
| secuencial no es anidamiento | `await run(…); await run(…)` → no lanza |

El caso "la excepción llega intacta" es el único no-obvio y el de mayor valor: sin él, un futuro
`throw new Error('transaction failed: ' + err.message)` rompería los mapeos 400/403/404/409/422 sin
que ningún otro test lo note.

### 7.4 El oráculo de concurrencia, sin modificar

`test/integration/concurrency/concurrency.integration.spec.ts` (511 líneas, 9 escenarios) debe pasar
tal cual. Los más sensibles a esta cirugía:

| Línea | Escenario | Qué falsaría |
| --- | --- | --- |
| `:75` | N inflows concurrentes, balance exacto | que el `FOR UPDATE` de la fila de cuenta se perdiera al mover la construcción del scoped a `createContext()` |
| `:179` | límite de budget con período vacío | el detector más limpio de la pérdida del lock de la fila de budget |
| `:400` | dos `DELETE /transactions/:id` (Race 3) | el orden de las operaciones dentro del callback |
| `:490` | dos `/auth/refresh` con el mismo token | **el más importante de este plan**: valida la reestructuración de §2.4.b. Exige exactamente un 200 y un 401 |

`test/integration/auth/` y el escenario `:490` son la red del cambio de mayor riesgo. Si sólo se
pudiera correr un test tras el commit de auth, es ése.

### 7.5 Comandos

```bash
npm run lint                 # no-unused-vars=error atrapa imports huérfanos (Scope, QueryRunner, …)
npx tsc --noEmit -p tsconfig.json
npm test                     # unitarios
npm run test:integration     # requiere Postgres + Redis
```

---

## 8. Riesgos

### 8.1 Fuga del `EntityManager` fuera del callback — el riesgo que pide el enunciado

```ts
let escaped: IAccountRepository;
await this.uow.run(async (ctx) => { escaped = ctx.accounts; });
await escaped.save(account);        // ← post-commit, post-release: sin transacción y sin conexión
```

**¿Se puede prevenir? Parcialmente, y conviene ser preciso sobre cada capa:**

1. **Por tipos: no.** TypeScript no tiene lifetimes. Cualquier referencia capturada en un closure
   sobrevive al `run()`. Es el mismo límite que ya tiene el diseño actual (nada impide guardar el
   resultado de `getScopedAccountRepository()` en un campo).
2. **Modo de falla real:** tras `qr.release()`, el `QueryRunner` queda con `isReleased === true`
   (`node_modules/typeorm/query-runner/QueryRunner.d.ts:38`) y `PostgresQueryRunner.query()` lanza
   `QueryRunnerAlreadyReleasedError` en su primera línea
   (`node_modules/typeorm/driver/postgres/PostgresQueryRunner.js:169-170`). O sea: **TypeORM ya
   convierte la fuga en un throw determinista, no en una escritura silenciosa en autocommit.** Es una
   mitigación real que no depende de nosotros. Verificado en el código instalado (0.3.28).
3. **Mitigación adicional barata (recomendada): invalidar el contexto al salir.** Envolver `ctx` en un
   `Proxy` cuyo `get` lance si el `run()` ya terminó:

   ```ts
   const live = { value: true };
   const guarded = new Proxy(ctx as object, {
     get(target, prop) {
       if (!live.value) {
         throw new Error(
           'El contexto transaccional se usó fuera de run(). Los recursos escopados ' +
             'sólo son válidos dentro del callback: no los guardes en variables externas.',
         );
       }
       return Reflect.get(target, prop);
     },
   }) as TCtx;
   try { … } finally { live.value = false; await qr.release(); }
   ```

   Cuesta ~8 líneas en un solo archivo y convierte un `QueryRunnerAlreadyReleasedError` genérico en un
   mensaje que nombra la causa. **Limitación honesta: sólo cubre la fuga del `ctx`, no la de una
   propiedad ya extraída** (`const repo = ctx.accounts` dentro del callback y usado después sigue
   pasando por (2)). No es una barrera, es un mejor mensaje de error.
4. **Regla escrita** en CLAUDE.md: *"nada de lo que entrega `ctx` puede sobrevivir al callback: ni
   asignado a un campo, ni retornado. `run()` devuelve datos de dominio, nunca recursos."*

   Éste es el punto de code review, y es el que realmente decide. Detección barata:
   `grep -rn "return ctx\." src` debería dar 0.

### 8.2 Riesgo alto: la reestructuración de `RefreshTokenUseCase`

Es el único cambio que toca lógica de seguridad (replay detection). Si la revocación de familia
quedara del lado del rollback, un atacante que replaya un token **no** perdería la cadena.

*Mitigación:* commit aislado sólo para auth; el spec conserva `expect(uow.commits()).toBe(1)` en el
caso replay (`refresh-token.use-case.spec.ts:117`) — que es exactamente la aserción que rompe si el
desenlace pasa a ser una excepción dentro del callback; más el escenario de integración
`concurrency.integration.spec.ts:490`.

### 8.3 Riesgo medio: pérdida de `FOR UPDATE` al mover la construcción de los scoped

Mismo riesgo que documentan los planes hermanos (`PLAN-P1P2-accounts.md:470-496`,
`PLAN-P1P2-budgets.md:471-481`), y la misma mitigación: los cuerpos de los scoped **no se tocan** en
este plan; sólo cambia quién los construye y cuándo. El diff de `createContext()` debe leerse como
"las mismas cuatro líneas `new ScopedX(...)` que estaban en los getters".

### 8.4 Riesgo medio: sobrecarga del `AsyncLocalStorage`

No medido. El store se entra una vez por transacción, no por query, y una transacción implica al menos
tres round-trips a Postgres, así que el costo relativo debería ser despreciable — **pero es una
afirmación de primeros principios, no una medición.** Si preocupa, el runner puede aceptar un flag de
entorno para desactivar el detector; no lo propongo por defecto (una guarda que se apaga en producción
protege justo donde no hace falta).

### 8.5 Riesgo bajo

- **Reentrada legítima que el detector rompa.** No existe hoy: ningún use case anida `run()` (§5.1).
  Si alguien la necesitara en el futuro, la respuesta correcta es componer dentro de un solo `run()`,
  no relajar el guard.
- **Cobertura.** `package.json` §`jest.coverageThreshold` exige `branches: 70` en
  `src/modules/**/application/**`. Los use cases pierden ramas (los `catch` desaparecen), lo que
  **sube** el porcentaje. El runner vive en `shared/infrastructure/`, fuera de los umbrales, pero
  igual lleva sus propios tests (§7.3).
- **Migraciones / esquema.** Cero cambios.

---

## 9. Lo que NO cambia

| Elemento | Por qué |
| --- | --- |
| Los cuerpos de los repos escopados y sus comentarios de lock | se mueven de constructor, no de contenido |
| El orden lock → agregado en los tres flujos (`create-transaction.use-case.ts:106→124`, `delete-budget.use-case.ts:26→33`, `update-budget-limit.use-case.ts:34→42`) | queda idéntico dentro del callback |
| Los puertos de repositorio (`IAccountRepository`, `IBudgetRepository`, `IScopedTransactionRepository`, `IExpenseChecker`, `IRefreshTokenRepository`) | P5 va **después** de este plan (decisión de orden, cabecera). Los contextos de §2.2 nacen con los tipos anchos de hoy; P5 los estrecha luego cambiando 3 renglones de interfaz |
| El mapeo excepción → HTTP | ninguna excepción de dominio se agrega, quita ni envuelve |
| Los controllers | inyectan use cases; sus constructores no cambian |
| `test/integration/**` | salvo el archivo **nuevo** de §7.2 |
| La caché y el arreglo de P7 | §3.2 |

---

## 10. Orden de commits y coordinación

### 10.1 Por qué después de P1+P2 — **condición ya cumplida**

*(Sección histórica: se conserva porque explica por qué el rework era aceptable, pero la decisión ya
se ejecutó y no hay nada que coordinar.)*

Los dos planes hermanos están cerrados (accounts: `91de97b` · `b026ac8` · `19eed72`; budgets:
`83d4c15` · `dc35dc7` · `ac40f03` · `b140cf4`). Ambos instruían **copiar** el ciclo de vida existente
en vez de rediseñarlo, precisamente para que su diff fuera un movimiento puro y auditable. Adelantar
P3+P4 habría invalidado esas instrucciones a mitad de ejecución.

**El costo previsto se pagó y es visible hoy:** los dos impls nuevos nacieron con el molde viejo y se
reescriben ahora (~30 líneas → ~12 cada uno). Y salió un poco más caro de lo estimado, porque P7 pasó
en el medio y escribió su guard cuatro veces en vez de dos (§1.3, §3.3). Sigue siendo rework mecánico
y acotado — pero conviene registrarlo como dato para la próxima decisión de este tipo: **cada ciclo
que el ciclo de vida manual sobrevive, la siguiente cirugía sobre él cuesta una copia más.**

Consecuencia que sí sigue viva: `PLAN-P1P2-accounts.md:520-523` recomendaba verificar que `release()`
pusiera `queryRunner = null` *"porque P4 lo va a usar"*. Con este diseño **P4 no lo usa** —
`isConnected()` se borra entero (§1.2). Esa verificación no aplica.

### 10.2 Secuencia — siempre verde, el riesgo concentrado en un commit chico

La clave es que `IUnitOfWork` puede llevar **`run()` y los cinco métodos viejos a la vez** durante la
migración, de modo que cada módulo se convierta por separado.

| # | Commit | Alcance | Verde tras |
| --- | --- | --- | --- |
| **1** | `feat(shared): stateless transaction runner + nested-transaction detector` | los 4 archivos nuevos de §6.1. **Nadie lo usa.** | `npm test` (los tests del runner son nuevos) |
| **2** | `refactor(shared): add run() to IUnitOfWork alongside the manual lifecycle` | `IUnitOfWork` gana `run<T>` **sin quitar nada**; los 2 impls (4 tras P1/P2) y los 2 fakes lo implementan reusando su propio `begin/commit/rollback/release`. Sigue todo `Scope.REQUEST` | suite completa; comportamiento idéntico |
| **3** | `refactor(accounts): move Archive/Unarchive/Rename to uow.run()` | 3 use cases + 3 specs | unit + integración |
| **4** | `refactor(budgets): move DeleteBudget/UpdateBudgetLimit to uow.run()` | 2 use cases + 2 specs | unit + integración (`:179`, `:224`, `:448`) |
| **5** | `refactor(transactions): move Create/DeleteTransaction to uow.run()` | 2 use cases + 2 specs + `in-memory-unit-of-work.ts` | unit + integración (`:75`, `:117`, `:293`, `:358`, `:400`) |
| **6** | `refactor(auth): express replay detection as a committed outcome` | `refresh-token.use-case.ts` + `in-memory-auth-unit-of-work.ts`; el spec **no cambia** | unit + integración (`:490`) — **el commit de mayor riesgo** |
| **7** | `refactor(shared): drop the manual lifecycle; UoW providers become singletons` | borrar `begin/commit/rollback/release/isConnected` del puerto, de los 4 impls y de los 2 fakes; los impls pasan a `extends TypeOrmTransactionRunner`; quitar `Scope.REQUEST` de los 4 módulos; **reemplazar `rollback-guard.integration.spec.ts`** (§3.3); test de §7.2 | **suite completa + el test de scope de DI** |
| **8** | `docs: …` | §6.5 | — |

**Puntos de rollback:**

- **Tras el 2**: el runner existe y coexiste; revertir es trivial y el sistema queda como hoy.
- **Tras el 6**: los 8 use cases ya usan `run()` y ningún comportamiento cambió — pero **P3 todavía
  no está resuelto** (los impls siguen siendo statefull y `Scope.REQUEST`). Es un estado coherente y
  valioso por sí solo: **P4 ya está cerrado** (ningún use case maneja el ciclo de vida a mano) sin
  haber tocado el grafo de DI.
- **El 7 es el único commit con riesgo de DI**, y su diff es pequeño porque los 6 anteriores ya
  hicieron el trabajo. Si el boot falla, se revierte solo el 7 y se conserva todo P4.

Esa partición es la respuesta a *"P3 == P4, una cirugía compra las dos"* (`PROBLEMS.md:287`): sí, es
un solo diseño — pero se puede aterrizar en dos mitades, y la mitad que paga sola (P4) va primero.

### 10.3 Coordinación con P7 — **cerrado en `0d3f3d5`**

P7 endureció `rollback()` en los **cuatro** impls (no dos, como decía este plan cuando se escribió) y
movió la invalidación de caché a un `try/catch` post-commit en `DeleteBudget` y `UpdateBudgetLimit`.
Nada de eso entra en conflicto con este plan; todo queda **absorbido por el commit 7**, donde el ciclo
de vida manual se borra entero.

Qué sobrevive y qué no, explícito para que el commit 7 no se lea como una regresión:

| Artefacto de P7 | Destino bajo el runner |
| --- | --- |
| El guard `isTransactionActive` ×4 (§3.3) | **se borra**; su intención vive en el `try/catch` del runner, escrito una vez |
| La invalidación post-commit en los 2 use cases | **sobrevive y se simplifica**: deja de necesitar el `try` anidado (§3.2) |
| Los tests unitarios de la invalidación | **siguen válidos** y siguen fallando en rojo si alguien mete la invalidación dentro del callback |
| `rollback-guard.integration.spec.ts` | **se reemplaza** por el equivalente sobre `run()` (§3.3, §7.3) — el contrato que prueba deja de tener superficie pública |
| El rename `isActive()` → `isConnected()` | **se borra el método**. El rename no fue trabajo perdido: su valor real fue *diagnóstico* — reveló que los impls y los fakes habían derivado a semánticas opuestas sin que nadie lo notara, que es la evidencia de que el método no tenía llamadores y podía eliminarse |
