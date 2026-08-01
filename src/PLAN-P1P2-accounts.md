# Plan P1 + P2 — par `accounts` ↔ `transactions`

> Alcance: **solo** el par accounts↔transactions. `budgets` (`ScopedExpenseChecker`,
> `ScopedBudgetRepository`, `IBudgetUnitOfWork`) lo planifica otro agente; este plan no lo toca y
> marca explícitamente los puntos de coordinación.
> Referencia del problema: `src/PROBLEMS.md` §P1 y §P2. Acá no se repite el enunciado; se aporta la
> verificación en código, la decisión de diseño pendiente, el diff propuesto y el criterio de prueba.

---

## 0. Estado actual vs. propuesta

### 0.1 Lo que YA está implementado hoy (estado anterior, nada de esto es propuesta)

| Pieza | Dónde | Cómo está hoy |
| --- | --- | --- |
| Puerto `IAccountUnitOfWork` | `accounts/domain/IAccountUnitOfWork.ts` | **Ya está en su lugar correcto.** Expone un solo getter. No se toca |
| Provider del puerto | `transactions.module.ts:71-74`, exportado en `:76` | Lo declara **transactions**, que nunca lo inyecta. Existe solo para alimentar a accounts |
| Import de vuelta | `accounts.module.ts:15` y `:29` | `forwardRef(() => TransactionsModule)` — **única** arista `accounts → transactions` en todo el módulo |
| `ScopedAccountRepository` | privado dentro de `transactions/infrastructure/persistence/unit-of-work.impl.ts` | Toma el `FOR UPDATE` sobre la fila de cuenta (mecanismo de la Race 2), escrito fuera del módulo dueño |
| Los 3 use cases | `archive` / `unarchive` / `rename` | Inyectan `IAccountUnitOfWork` y usan **solo** `getScopedAccountRepository()` + ciclo de vida (`findById`, `save`) |
| ORM | `account.orm.entity.ts:9` | Importa solo `UserOrmEntity` → **no hay ciclo a nivel ORM** |
| Test que verifique el `FOR UPDATE` de cuenta | — | **No existe uno directo.** Ver §7.1 |

**Consecuencia del estado actual:** el ciclo es puramente de composición. Ningún use case, entidad, VO, mapper, repo ni controller de accounts importa nada de transactions — solo el archivo de módulo, y solo por el token.

### 0.2 Lo que este plan PROPONE cambiar

| # | Propuesta | Estado |
| --- | --- | --- |
| 1 | **CREAR** `accounts/infrastructure/persistence/scoped-account.repository.ts` — el repo scoped y su `FOR UPDATE` vuelven a su módulo dueño | ✅ §4 paso 1 |
| 2 | **CREAR** `accounts/infrastructure/persistence/account-unit-of-work.impl.ts` — UoW propio, molde de `AuthUnitOfWorkImpl` | ✅ §4 paso 2 |
| 3 | **EDITAR** `accounts.module.ts` — cae el `forwardRef`, entra el provider propio | ✅ §4 paso 3 |
| 4 | **EDITAR** `transactions.module.ts` + `unit-of-work.impl.ts` — cae el binding y el export ajenos; transactions compone la pieza que accounts publica | ✅ §4 pasos 4-5 |
| 5 | **CREAR** un test unitario que assertee la opción `lock` en `findOne` | ✅ §4 paso 6 — **obligatorio**, ver abajo |
| 6 | P5 (angostar el puerto a una capacidad acotada) | ⏸ **Diferido** — §3 |

**Los 3 use cases y sus `.spec.ts` NO cambian.** Es criterio de corrección, no aspiración: si el plan los obliga a cambiar, el plan está mal (§5).

### 0.3 Dos advertencias sobre este documento

**1. La decisión de diseño de §2.4 quedó superada.** Este plan recomienda la **Opción A endurecida** (publicar la clase scoped con un guard en el constructor). Tras contrastarla con el plan hermano de budgets, la decisión adoptada es la **Opción B — factory acotada que recibe un `QueryRunner`, no un `EntityManager`**: con esa firma `dataSource.manager` **deja de compilar**, lo que mueve la verificación de runtime a tiempo de compilación, y además valida `isTransactionActive`, cubriendo el caso de un runner conectado pero sin transacción abierta que el guard de constructor deja pasar. El diagnóstico del riesgo en §2.2 sigue siendo válido y vale la pena leerlo; lo que cambia es dónde se ataja. Ver `src/PLAN-P1P2-budgets.md` §2.

**2. El oráculo de integración es necesario pero NO suficiente.** Si el `FOR UPDATE` del lado accounts desapareciera, el test de la Race 2 (`concurrency.integration.spec.ts:357-389`) **pasaría igual**. Por eso el test unitario del punto 5 no es opcional. Detalle en §7.1.

---

## 1. Estado verificado del acoplamiento

### 1.1 Todo lo que `accounts` importa de `transactions`

Búsqueda exhaustiva sobre `src/modules/accounts/**` (case-insensitive, término `transactions`):

| Ubicación                | Contenido                                             |
| ------------------------ | ----------------------------------------------------- |
| `accounts.module.ts:15`  | `import { TransactionsModule } from '../transactions/transactions.module';` |
| `accounts.module.ts:29`  | `forwardRef(() => TransactionsModule)` en `imports`    |
| `accounts/notes.md:90-105,153-156` | prosa documental (no compila)               |

**Confirmado: la única arista `accounts → transactions` es el import del módulo, y su única razón es
resolver el token `IAccountUnitOfWork`.** Ningún use case, entidad, VO, mapper, repo, controller ni
DTO de accounts importa nada de transactions. `AccountOrmEntity` (`account.orm.entity.ts:9`) importa
solo `UserOrmEntity` — no hay relación inversa hacia `TransactionOrmEntity`, así que tampoco hay
ciclo a nivel de entidades ORM (el `@ManyToOne` vive del lado de transactions,
`transaction.orm.entity.ts:10,54-60`).

Corolario verificado: `IAccountUnitOfWork` no se inyecta en ningún lado fuera de accounts. Los
únicos consumidores son `ArchiveAccountUseCase:14`, `UnarchiveAccountUseCase:14`,
`RenameAccountUseCase:15` (y sus tres `.spec.ts`). `transactions` **provee y exporta** el token
(`transactions.module.ts:71-74`, `:76`) pero **no lo inyecta en ningún archivo**.

### 1.2 Todo lo que `transactions` importa de `accounts` (dirección legítima, se conserva)

| Ubicación                                        | Qué importa                                       | ¿Sobrevive al refactor? |
| ------------------------------------------------ | ------------------------------------------------- | ----------------------- |
| `transactions.module.ts:25,32`                    | `AccountsModule` (por `AccountMapper` + `GetAccountByIdUseCase`) | Sí, pero **sin `forwardRef`** |
| `transactions.module.ts:16,71-74,76`              | `IAccountUnitOfWork` (provider + export)          | **Se elimina** |
| `unit-of-work.impl.ts:5`                          | `IAccountUnitOfWork` (`implements`, línea 257)     | **Se elimina** |
| `unit-of-work.impl.ts:7`                          | `IAccountRepository` (tipo de retorno, línea 301)  | Sí |
| `unit-of-work.impl.ts:13,14,15`                   | `AccountOrmEntity`, `AccountMapper`, `Account`     | Solo `AccountMapper` (13 y 15 quedan huérfanos) |
| `ITransactionUnitOfWork.ts:3,20`                  | `IAccountRepository`                               | Sí |
| `create-transaction.use-case.ts:13,14`            | `GetAccountByIdUseCase`, `UpdateAccountBalanceUseCase` | Sí |
| `delete-transaction.use-case.ts:8,9`              | `UpdateAccountBalanceUseCase`, `InsufficientFundsException` | Sí |
| `get-transactions-by-account-id.use-case.ts:7`    | `GetAccountByIdUseCase`                            | Sí |
| `transactions.controller.ts:57`                   | excepciones de account                             | Sí |
| `transaction.orm.entity.ts:10`                    | `AccountOrmEntity` (FK)                            | Sí |
| `__fakes__/in-memory-unit-of-work.ts:4,18,49`     | `IAccountRepository`                               | Sí |

### 1.3 Verificación del hecho "los tres use cases solo usan `getScopedAccountRepository()`"

**Confirmado, línea por línea.** Los tres son el mismo esqueleto:

- `archive-account.use-case.ts:18` `begin()` → `:20` `getScopedAccountRepository()` → `:25`
  `findById` → `:30` `account.archive()` → `:31` `save` → `:32` `commit` → `:35` `rollback` →
  `:38` `release`.
- `unarchive-account.use-case.ts:18,20,25,30,31,32,35,38` — idéntico salvo `unarchive()`.
- `rename-account.use-case.ts:19,21,26,31,32,35,39` — idéntico salvo `rename(dto.name)`.

Superficie total consumida del puerto: `begin/commit/rollback/release` +
`getScopedAccountRepository()` → `findById` + `save`. **Cero** uso de
`getScopedTransactionRepository`, `getScopedBudgetRepository`, `getScopedExpenseChecker` o
`isActive`. Ninguno necesita compartir `QueryRunner` con otro módulo.

### 1.4 Por qué el split no puede debilitar la concurrencia (recordatorio, ya establecido)

`TypeOrmUnitOfWorkImpl` está bindeado con `Scope.REQUEST` (`transactions.module.ts:59`,
`unit-of-work.impl.ts:254`). Dos requests concurrentes ya tienen hoy instancias, `QueryRunner`s y
transacciones distintas. `useExisting` (`transactions.module.ts:63-74`) solo garantiza compartir
`QueryRunner` **dentro de un mismo request** — necesario únicamente para `CreateTransactionUseCase`,
que toma tres repos scoped en la misma transacción (`create-transaction.use-case.ts:92,93,97`). Lo
que serializa entre requests es el `FOR UPDATE` de `unit-of-work.impl.ts:108-114`, que se mueve de
archivo **sin cambiar de semántica**.

---

## 2. La decisión de diseño: ¿de dónde saca `transactions` el repo de cuentas escopado?

### 2.1 El requisito, preciso

Tras el split, `transactions` sigue necesitando leer-con-lock y guardar una cuenta sobre **su
propio** `QueryRunner`: `create-transaction.use-case.ts:93-94` y `:147-151`,
`delete-transaction.use-case.ts:27,35-43`, ambos vía
`new UpdateAccountBalanceUseCase(acctRepo)` (`update-account-balance.use-case.ts:10,17,31`). El
contrato `ITransactionUnitOfWork.getScopedAccountRepository()` (`ITransactionUnitOfWork.ts:20`) no
desaparece: la frontera multi-agregado es real y vive en transactions.

### 2.2 Reformulación del eje del problema

Las tres opciones del enunciado se distinguen en **dónde vive el código**. Pero el riesgo que
preocupa —"alguien construye el repo con `dataSource.manager` en autocommit y el `FOR UPDATE` se
evapora en silencio"— **no depende de eso**: depende de si la clase **valida su precondición**.

La garantía actual ("es privada al archivo, solo el UoW la construye") es *sintáctica*: no la impone
el compilador ni el runtime, la impone la disciplina de no exportar. Es fuerte mientras el archivo
sea uno solo, y **cae de golpe** en cuanto se exporta. Reemplazarla por una garantía de runtime es un
cambio de naturaleza, no una relajación:

```ts
// accounts/infrastructure/persistence/scoped-account.repository.ts
constructor(
  private readonly manager: EntityManager,
  private readonly mapper: AccountMapper,
) {
  super();
  const qr = manager.queryRunner;
  if (!qr || qr.isReleased || !qr.isTransactionActive) {
    throw new Error(
      'ScopedAccountRepository requiere un EntityManager ligado a un QueryRunner con ' +
        'transacción activa: sus FOR UPDATE no tienen efecto en autocommit.',
    );
  }
}
```

Verificado en el TypeORM instalado (0.3.28):

- `node_modules/typeorm/entity-manager/EntityManager.d.ts:39` → `readonly queryRunner?: QueryRunner`.
- `node_modules/typeorm/data-source/DataSource.js:58` → `this.manager = this.createEntityManager()`
  **sin** `queryRunner` ⇒ `dataSource.manager.queryRunner === undefined`.
- `DataSource.js:404,423-424` + `EntityManagerFactory.js:19` → el manager de un `QueryRunner` sí lo
  lleva.
- `node_modules/typeorm/query-runner/QueryRunner.d.ts:38,42` → `isReleased`, `isTransactionActive`.

O sea: el guard distingue exactamente el caso peligroso, y convierte el peor modo de falla
(silencioso, en producción, bajo carga) en un throw determinista la primera vez que se ejecuta la
ruta — en el primer test de integración que la toque.

### 2.3 Las tres opciones

| | Dónde vive el `FOR UPDATE` de la fila de cuenta | Fuentes de verdad | Ciclo | Riesgo de uso indebido |
| --- | --- | --- | --- | --- |
| **A** — accounts publica la clase | `accounts/infrastructure` | 1 | no | construible fuera de un UoW **si no hay guard** |
| **B** — accounts publica una factory | `accounts/infrastructure` | 1 | no | idéntico a A **si la factory no valida** |
| **C** — transactions mantiene copia privada | dos archivos | **2** | no | nulo por construcción, pero deriva garantizada |

**C se descarta.** Duplica el mecanismo exacto de la Race 2 en dos archivos, sin ningún test que
detecte la divergencia (ver §7.1: la suite de integración **no** detecta la pérdida del lock del lado
de accounts). Además contradice el objetivo declarado de P2 —ownership del *código* del lock— porque
deja la mitad del lock viviendo en transactions. Es peor que el estado actual: hoy hay una fuente de
verdad mal ubicada; con C habría dos, una de ellas bien ubicada, lo que da la ilusión de haber
resuelto P2.

**B vs A.** Una factory `createScopedAccountRepository(manager, mapper): IAccountRepository` permite
mantener la `class` sin exportar (nadie puede `extends` ni `new` directo). Es real pero marginal: la
precondición que importa es "manager transaccional", y esa se valida igual de bien en el constructor
que en la factory. A cambio, B introduce una función libre exportada en un repo donde **todo** es
clase (puertos como `abstract class` por el token de DI — CLAUDE.md), y obliga a un segundo nombre
(`createX` + `IX`) para la misma cosa.

### 2.4 Recomendación

**Opción A, endurecida: `accounts` publica `ScopedAccountRepository` desde su propia
infraestructura, con guard de precondición en el constructor.** `transactions` la compone sobre su
`QueryRunner`:

```ts
// transactions/infrastructure/persistence/unit-of-work.impl.ts
getScopedAccountRepository(): IAccountRepository {
  return new ScopedAccountRepository(this.queryRunner!.manager, this.accountMapper);
}
```

Dirección `transactions → accounts`, que ya existe y es permanente. Sin ciclo.

**Justificación generalizable** (aplica igual a `budgets` y a cualquier módulo futuro):

1. **La regla que cambia se enuncia sin perder fuerza.** Antes: "las clases scoped son privadas al
   archivo del impl". Después: *"una clase scoped es pública para su módulo dueño y privada para
   todos los demás en el sentido de que **solo puede construirse con un `EntityManager`
   transaccional**, y ella misma lo verifica"*. La segunda es más débil sintácticamente y **más
   fuerte operativamente**, porque la primera nunca fue verificada por nada.
2. **Un único dueño del lock.** El `FOR UPDATE` de la fila de cuenta queda en `accounts/`, junto a la
   entidad cuyo invariante protege. Es literalmente el enunciado de P2.
3. **Composición, no herencia de módulos.** El UoW multi-agregado de transactions pasa de *definir*
   las políticas de lock de sus vecinos a *componerlas*. Se vuelve lo que dice ser: un coordinador de
   frontera transaccional.
4. **Escala linealmente.** Con N agregados vecinos, A y B dan N clases con un dueño cada una; C da
   2N con N pares divergentes.

**Variante aceptable:** si se prefiere B, el plan es idéntico salvo que el archivo exporta
`createScopedAccountRepository()` y no la clase. No cambia ningún otro paso. Lo que **no** es
aceptable es publicar sin guard: eso sí es una relajación neta.

---

## 3. Ventana P5 (`PROBLEMS.md:250-269`) — evaluación y recomendación

**Recomendación: NO tomarla ahora. Commit aparte, después de que P1+P2 esté verde.**

Lo que costaría tomarla ahora (puerto acotado `IScopedAccountRepository` con solo lectura-con-lock +
`save`, sin `delete`):

| Archivo | Cambio |
| --- | --- |
| `accounts/domain/repository/scoped-account.repository.ts` | nuevo puerto |
| `accounts/domain/IAccountUnitOfWork.ts:5` | cambia el tipo de retorno |
| `transactions/domain/ITransactionUnitOfWork.ts:3,20` | cambia el tipo de retorno |
| `accounts/application/use-cases/update-account-balance.use-case.ts:10` | cambia el tipo del parámetro |
| `transactions/.../__fakes__/in-memory-unit-of-work.ts:4,18,49` | cambia el tipo |

Tres razones para diferirlo, en orden de peso:

1. **Rompe el criterio de corrección de este plan.** La convención del repo nombra el lock en el
   método: `findByIdWithLock` (`scoped-transaction.repository.ts:10` y su comentario `:7-8`),
   `findByTokenHashWithLock` (`auth-unit-of-work.impl.ts:26`). Un puerto acotado nuevo que se llamara
   `findById` nacería violando esa convención; uno que se llame `findByIdWithLock` **obliga a editar
   los tres use cases de accounts y sus tres `.spec.ts`** — exactamente lo que §5 prohíbe. Diferirlo
   permite hacer el rename como *el punto* de ese commit, no como daño colateral de este.
2. **Contamina el diff que hace verificable el refactor.** El argumento de P1 es "no toca lógica de
   negocio ni tests" (`PROBLEMS.md:80`). Mezclado con P5, el diff cruza `accounts/domain`,
   `accounts/application`, `transactions/domain` y los fakes, y deja de ser auditable como
   movimiento puro (§7.3 depende de eso).
3. **P5 es independiente por diseño** (`PROBLEMS.md:264`) y no compra nada hoy: nadie abusa de
   `delete()` desde transactions.

**Considerada y rechazada:** publicar la clase con `delete()` lanzando `Error('no disponible dentro
de un UoW')`. Cierra el agujero sin tocar tipos, pero crea una clase que miente sobre el contrato que
declara implementar (`IAccountRepository`). Cambiar una frontera no impuesta por una violación de
sustitución es un mal trade en una base que ya demostró preferir la imposición por tipos
(`IScopedTransactionRepository`).

**Lo único que sí conviene hacer ahora, y es gratis:** dejar `ScopedAccountRepository` en **su propio
archivo** (no dentro de `account-unit-of-work.impl.ts`). Cuando llegue P5, el cambio de tipo queda
localizado en un archivo y su test.

---

## 4. Cambios archivo por archivo, en orden de aplicación

### Paso 1 — CREAR `src/modules/accounts/infrastructure/persistence/scoped-account.repository.ts`

Movimiento **verbatim** de `unit-of-work.impl.ts:97-132`, más el guard de §2.2, más el bloque de
comentario `unit-of-work.impl.ts:21-29` adaptado (explica por qué el lock se sostiene hasta el commit
y por qué el manager debe ser transaccional — es la documentación del mecanismo de la Race 2 y debe
viajar con el código).

```ts
import { EntityManager } from 'typeorm';
import { IAccountRepository } from '../../domain/repository/accounts.repository';
import { Account } from '../../domain/entities/account.entity';
import { AccountOrmEntity } from './account.orm.entity';
import { AccountMapper } from './account.mapper';

export class ScopedAccountRepository extends IAccountRepository {
  constructor(
    private readonly manager: EntityManager,
    private readonly mapper: AccountMapper,
  ) {
    super();
    const qr = manager.queryRunner;
    if (!qr || qr.isReleased || !qr.isTransactionActive) {
      throw new Error(/* ver §2.2 */);
    }
  }

  // LOCK (FOR UPDATE): fila de cuenta, sostenido hasta el commit. …
  async findById(id: string): Promise<Account | null> {
    const orm = await this.manager.findOne(AccountOrmEntity, {
      where: { id },
      lock: { mode: 'pessimistic_write' },   // ← texto idéntico al original
    });
    return orm ? this.mapper.toDomain(orm) : null;
  }
  // findByUserId / save / delete: copia exacta de unit-of-work.impl.ts:116-131
}
```

Nota: no lleva `@Injectable()`. No es un provider — se construye a mano, como hoy.

### Paso 2 — CREAR `src/modules/accounts/infrastructure/persistence/account-unit-of-work.impl.ts`

Molde: `auth/infrastructure/persistence/auth-unit-of-work.impl.ts:60-100`.

```ts
@Injectable({ scope: Scope.REQUEST })
export class AccountUnitOfWorkImpl extends IAccountUnitOfWork {
  private queryRunner: QueryRunner | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly mapper: AccountMapper,
  ) { super(); }

  // begin/commit/rollback/release/isActive: idénticos a auth-unit-of-work.impl.ts:71-92

  getScopedAccountRepository(): IAccountRepository {
    return new ScopedAccountRepository(this.queryRunner!.manager, this.mapper);
  }
}
```

`AccountMapper` ya es provider de accounts (`accounts.module.ts:34`). `AccountOrmEntity` ya está en
`forFeature` (`accounts.module.ts:28`) y `autoLoadEntities: true` (`app.module.ts:112`) garantiza que
el `manager.findOne(AccountOrmEntity, …)` resuelva metadata desde cualquier módulo — como ya ocurre
hoy desde transactions.

### Paso 3 — EDITAR `src/modules/accounts/accounts.module.ts`

- **Borrar** `:15` (import de `TransactionsModule`) y `:29` (`forwardRef(() => TransactionsModule)`).
- **Borrar** `forwardRef` del import de `@nestjs/common` (`:1`); **agregar** `Scope`.
- **Agregar** imports de `IAccountUnitOfWork` y `AccountUnitOfWorkImpl`.
- **Agregar** en `providers`:

```ts
{ provide: IAccountUnitOfWork, useClass: AccountUnitOfWorkImpl, scope: Scope.REQUEST },
```

  Auth usa dos providers (`auth.module.ts:67-72`: clase concreta + `useExisting`). Esa forma solo es
  necesaria cuando **varios** tokens deben aliasar la misma instancia; accounts tiene un único token,
  así que un provider basta. (Copiar la forma de auth tampoco rompe nada; es indirección sin
  beneficio.)
- **NO** agregar `IAccountUnitOfWork` a `exports` (`:50`). Nadie fuera de accounts lo inyecta (§1.1);
  exportarlo reabre la puerta que este refactor cierra.
- `imports` queda solo con `TypeOrmModule.forFeature([AccountOrmEntity])`. **`accounts` pasa a ser
  hoja.**

### Paso 4 — EDITAR `src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts`

- **Borrar** la clase privada `ScopedAccountRepository` (`:97-132`).
- **Agregar** `import { ScopedAccountRepository } from '../../../accounts/infrastructure/persistence/scoped-account.repository';`
- **Borrar** imports que quedan huérfanos: `:5` (`IAccountUnitOfWork`), `:13` (`AccountOrmEntity`),
  `:15` (`Account`). **Conservar** `:7` (`IAccountRepository`, tipo de retorno en `:301`) y `:14`
  (`AccountMapper`, inyectado en `:264` y usado para construir el repo scoped).
  ⚠ `@typescript-eslint/no-unused-vars` está en `error` (`eslint.config.mjs`): dejarlos rompe el
  lint, que es la red de seguridad de este paso.
- **Editar** `:255-258`: quitar `IAccountUnitOfWork` de la cláusula `implements`. Queda
  `extends ITransactionUnitOfWork implements IBudgetUnitOfWork` (hasta que el agente de budgets quite
  también ese).
- **NO tocar** `getScopedAccountRepository()` (`:301-306`) salvo el cuerpo: sigue existiendo porque
  `ITransactionUnitOfWork:20` lo exige.

### Paso 5 — EDITAR `src/modules/transactions/transactions.module.ts`

- **Borrar** `:16` (import de `IAccountUnitOfWork`), `:71-74` (el provider) y `IAccountUnitOfWork` de
  `exports` (`:76`).
- **Cambiar** `:32` `forwardRef(() => AccountsModule)` → `AccountsModule`. Ya no hay ciclo de
  archivos con accounts (verificar §6.4). **Conservar** el import de `forwardRef` mientras
  `:34` (`BudgetsModule`) siga necesitándolo — punto de coordinación con el agente de budgets: quien
  cierre segundo borra el import de `forwardRef`.
- **Corregir** el comentario de `:32`: accounts exporta `AccountMapper`, `GetAccountByIdUseCase` y
  `GetAccountsByUserIdUseCase` (`accounts.module.ts:50`); **no** exporta `IAccountRepository`. El
  comentario está desactualizado hoy.

### Paso 6 — CREAR `src/modules/accounts/infrastructure/persistence/scoped-account.repository.spec.ts`

Ver §7.2. Es la única red de regresión determinista sobre el lock. Dos casos:

```ts
it('toma FOR UPDATE al leer por id', async () => {
  const findOne = jest.fn().mockResolvedValue(null);
  const manager = { queryRunner: { isReleased: false, isTransactionActive: true }, findOne };
  await new ScopedAccountRepository(manager as unknown as EntityManager, new AccountMapper())
    .findById('a1');
  expect(findOne).toHaveBeenCalledWith(AccountOrmEntity, {
    where: { id: 'a1' },
    lock: { mode: 'pessimistic_write' },
  });
});

it('rechaza un EntityManager no transaccional', () => {
  expect(() => new ScopedAccountRepository({} as EntityManager, new AccountMapper())).toThrow();
});
```

### Paso 7 — Documentación (misma PR; CLAUDE.md lo exige explícitamente)

| Archivo | Qué corregir |
| --- | --- |
| `CLAUDE.md` | tabla de puertos UoW (`IAccountUnitOfWork` → `AccountUnitOfWorkImpl`); snippet de `useExisting` (quitar la línea de accounts); "Why the impl lives in `transactions`"; lista de "Scoped resources"; fila de `ScopedAccountRepository.findById` en el mapa de locks (nueva ruta); jerarquía de módulos (accounts pasa a hoja) |
| `src/shared/domain/uow-decision.md:13-14` | "Level 3 - Single implementation" ya es falso (hay 2 impls hoy, 3 después) |
| `docs/architecture.md:134,152,163,170` | fila del puerto y diagrama |
| `docs/concurrency-model.md:60-61,68,77,323` | "satisfies 3 ports vía useExisting" y ubicación del `ScopedAccountRepository` |
| `src/modules/accounts/notes.md:87,94-105,156` | dónde vive el lock; `getAccountRepository()` está mal escrito (`:98`), el método real es `getScopedAccountRepository()` |
| `src/modules/transactions/notes.md:50,121,203-204` | ídem |

---

## 5. Qué NO debe cambiar (criterio de corrección)

Ninguno de estos archivos debe aparecer en el diff. Si aparecen, el plan está mal ejecutado:

| Archivo | Por qué no necesita cambiar |
| --- | --- |
| `accounts/application/use-cases/archive-account.use-case.ts` | inyecta `IAccountUnitOfWork` (`:14`), token sin cambios |
| `.../unarchive-account.use-case.ts` (`:14`) | ídem |
| `.../rename-account.use-case.ts` (`:15`) | ídem |
| `archive-account.use-case.spec.ts` | construye el use case a mano con un mock literal (`:11-18`, `:31-33`): no pasa por DI ni por `Test.createTestingModule`. Es ciego al cableado |
| `unarchive-account.use-case.spec.ts`, `rename-account.use-case.spec.ts` | ídem (`:32`) |
| `accounts/domain/IAccountUnitOfWork.ts` | ya está donde debe; firma intacta (P5 diferido, §3) |
| `accounts/domain/repository/accounts.repository.ts` | intacto |
| `accounts/application/use-cases/update-account-balance.use-case.ts` | sigue recibiendo `IAccountRepository` (`:10`) |
| `accounts/infrastructure/persistence/account.repo.implement.ts` | el repo global sin lock no se toca |
| `accounts/infrastructure/http/.../accounts.controller.ts` | inyecta use cases, no el UoW |
| `transactions/application/use-cases/*.ts` | `create-transaction.use-case.ts:93` y `delete-transaction.use-case.ts:27` siguen llamando `getScopedAccountRepository()` con el mismo tipo |
| `transactions/domain/ITransactionUnitOfWork.ts` | contrato intacto (P5 diferido) |
| `transactions/.../__fakes__/in-memory-unit-of-work.ts` | tipos intactos |
| `test/integration/concurrency/concurrency.integration.spec.ts` | es el oráculo; modificarlo invalida la verificación |

**Argumento estructural:** el token de DI (`IAccountUnitOfWork`), su firma
(`getScopedAccountRepository(): IAccountRepository`) y la clase que efectivamente se construye
(`ScopedAccountRepository`, movida byte a byte) son invariantes de este refactor. Lo único que cambia
es **qué módulo declara el provider** y **en qué archivo vive la clase**. Ninguna de esas dos cosas es
observable desde un use case ni desde un test unitario que mockea el puerto.

**Si el plan te obliga a tocar los tres use cases**, la causa casi segura es haber tomado P5 dentro de
este commit y renombrado `findById` → `findByIdWithLock`. Ésa es la señal de que P5 se coló; sacarlo
(§3).

---

## 6. Verificación

### 6.1 Comandos, en este orden

```
npm run lint                 # detecta los imports huérfanos del Paso 4 (no-unused-vars = error)
npx tsc --noEmit -p tsconfig.json
npm test                     # unit; debe pasar SIN haber editado ningún .spec.ts existente
npm run test:integration     # requiere Postgres de test; corre con --runInBand
```

### 6.2 El oráculo

`test/integration/concurrency/concurrency.integration.spec.ts`, **sin modificar**:

| Línea | Escenario | Qué prueba respecto de este refactor |
| --- | --- | --- |
| `:357` | Race 2 — `POST /transactions` vs `PATCH /accounts/:id/archive` | que el UoW nuevo de accounts y el de transactions siguen compitiendo por la **misma fila** (ver la advertencia de §7.1) |
| `:399` | Race 3 — dos `DELETE /transactions/:id` | que la reversión del balance sigue ocurriendo una sola vez |
| `:74`  | N=10 inflows concurrentes, balance exacto `10_000 + N*100` | **detector duro** del `FOR UPDATE` de la fila de cuenta por la ruta transactions |
| `:292` | dos gastos, misma cuenta, budget distinto (`9_920`) | **detector duro** que aísla el lock de cuenta del lock de budget (ver comentario `:284-291`) |
| `:447` | Race 1 (budgets) | no debe regresionar: la única prueba de que no rompimos al vecino |

### 6.3 Verificaciones adicionales al bootstrap

- La app arranca (`npm run test:integration` levanta `AppModule` completo vía
  `test/helpers/app-bootstrap.ts:29-31`). Si el provider quedara sin registrar, Nest falla en
  `compile()` con `Nest can't resolve dependencies of the ArchiveAccountUseCase` — error ruidoso.
- Si se olvida quitar `IAccountUnitOfWork` de `exports` (`transactions.module.ts:76`) tras borrar el
  provider, Nest lanza `Nest cannot export a provider that is not a part of the currently processed
  module` — también ruidoso.

### 6.4 Verificación estructural (la prueba de que P1 se cumplió)

```
# 1) accounts no menciona transactions en ningún .ts
grep -rn "transactions" src/modules/accounts --include=*.ts        # → sin resultados

# 2) el forwardRef de transactions hacia accounts cayó
grep -n "forwardRef" src/modules/transactions/transactions.module.ts
#    → solo debe quedar la línea de BudgetsModule (hasta que el agente hermano cierre budgets)

# 3) el token ya no lo provee un tercero
grep -rn "IAccountUnitOfWork" src --include=*.ts
#    → solo accounts/** (dominio, 3 use cases, 3 specs, accounts.module.ts)
```

No hay regla `import/no-cycle` en `eslint.config.mjs` (el plugin `eslint-plugin-import` está en
devDependencies pero no registrado en la config flat), así que el ciclo no se detecta
automáticamente: los tres greps de arriba son la verificación. Alternativa opcional:
`npx madge --circular --extensions ts src` (no está instalado; no lo agrego por un chequeo puntual).

---

## 7. Riesgos y modos de falla — con foco en los silenciosos

### 7.1 ⚠ El riesgo principal: **el oráculo es más débil de lo que aparenta**

Analizando las aserciones de `:357` (Race 2): si el lock del lado de accounts desapareciera, el
interleaving más probable es — `archive` commitea; `POST /transactions` ya había leído la cuenta
(snapshot previo, sin `FOR UPDATE` no bloquea) → 201, balance 10_100. El test evalúa
`createWon = postRes.status === 201` (`:380`) y espera balance `10_100` (`:389`): **pasa**. También
pasaría el caso inverso. Es decir, **la Race 2 puede quedar verde con el lock roto**; su valor real es
detectar 500s y estados incoherentes, no la ausencia del lock.

Los detectores duros del `FOR UPDATE` de la fila de cuenta (`:74` y `:292`) ejercitan **la ruta de
transactions**, que en este plan no cambia de clase (sigue usando la misma
`ScopedAccountRepository`). Conclusión honesta: **si el UoW nuevo de accounts se escribiera sin el
`lock: { mode: 'pessimistic_write' }`, la suite completa podría pasar en verde.** Éste es exactamente
el modo de falla silenciosa que el enunciado pide identificar.

Mitigaciones, en orden de fuerza:

1. **El test unitario del Paso 6** (`scoped-account.repository.spec.ts`): asserta la opción `lock` en
   la llamada a `findOne`. Determinista, sin DB, milisegundos. **Es la mitigación que cierra el
   agujero**, y es el aporte de este refactor a P2: la política de lock queda *probada* en el módulo
   que la posee.
2. **Una sola clase.** Como accounts y transactions comparten la misma
   `ScopedAccountRepository` (opción A, §2.4), no existe la posibilidad de que una tenga el lock y la
   otra no. Con la opción C sí existiría — segunda razón para descartarla.
3. **Inspección de SQL, una vez, a mano:** correr con `DB_LOGGING=true` un
   `PATCH /accounts/:id/archive` y confirmar en el log `SELECT … FROM "accounts" … FOR UPDATE`.
   Barato como verificación puntual post-merge.

### 7.2 Riesgo: perder el guard o construir el repo con `dataSource.manager`

Cubierto por el guard de §2.2 (throw determinista) + su test unitario. Sin guard, este riesgo es
severo y silencioso.

### 7.3 Riesgo: que el "movimiento" no sea un movimiento

Que alguien reescriba el cuerpo del repo al moverlo (p. ej. cambiar `pessimistic_write` por
`pessimistic_read`, o agregar un `.orderBy`) y nadie lo note. Detección:

```
git diff -M --find-copies-harder --stat
git diff -M -- src/modules/accounts/infrastructure/persistence/scoped-account.repository.ts \
               src/modules/transactions/infrastructure/persistence/unit-of-work.impl.ts
```

El hunk de `findById/findByUserId/save/delete` debe leerse como copia exacta salvo el constructor y
los imports. Cualquier otra línea modificada exige justificación explícita en la PR.

### 7.4 Riesgo: consumo de conexiones del pool

Nulo. Cada request abre a lo sumo un `QueryRunner` como hoy; el `release()` en `finally` de los tres
use cases (`archive:38`, `unarchive:38`, `rename:39`) no cambia. `DB_POOL_MAX` (`app.module.ts:129`)
igual. Lo que sí conviene chequear en revisión: que `AccountUnitOfWorkImpl.release()` haga
`queryRunner = null` como `auth-unit-of-work.impl.ts:85-88` (si se omite, `isActive()` miente — hoy
nadie lo llama, pero P4 lo va a usar).

### 7.5 Riesgo: creer que P1 arregla P3

No lo hace, y conviene decirlo en la PR. `AccountsController` sigue siendo `Scope.REQUEST`; solo
cambia de qué módulo viene el provider que lo contagia. Único efecto colateral positivo, menor: la
instancia request-scoped de accounts deja de arrastrar `TransactionMapper` y `BudgetMapper`
(`unit-of-work.impl.ts:262-266`) — construye un objeto más liviano por request.

### 7.6 Riesgo de coordinación con el agente de budgets

Ambos planes editan `transactions.module.ts` y `unit-of-work.impl.ts`. Conflicto de merge casi
seguro, pero **textual y trivial** (bloques adyacentes: providers `:67-70` vs `:71-74`, cláusula
`implements` en `:257`). Regla: quien mergee segundo rebasea y verifica que el import de `forwardRef`
(`:1`) solo se borre cuando **ambas** aristas hayan caído. Ninguno de los dos planes toca los
archivos del otro dominio.

### 7.7 Riesgo: `synchronize` / migraciones

Nulo. Cero cambios de esquema, de entidad ORM y de migraciones.

---

## 8. Orden de commits y punto de rollback

Tres commits; cada uno compila y pasa la suite completa.

| # | Contenido | Estado tras el commit |
| --- | --- | --- |
| **1** | Pasos 1, 2 y 6: nueva `ScopedAccountRepository`, `AccountUnitOfWorkImpl`, test unitario del lock. **Nada cableado, nada borrado.** El código viejo sigue sirviendo el token. | Código muerto que ya está probado. Suite verde por definición (solo agrega archivos). Riesgo cero. |
| **2** | Pasos 3, 4 y 5: el switch de cableado. Accounts se auto-provee; transactions borra la clase privada, el provider y el `forwardRef`. | **El commit del refactor.** Punto de verificación completo (§6). |
| **3** | Paso 7: documentación. | Docs alineadas con el código. |

**Punto de rollback: `git revert` del commit 2.** Es autocontenido y devuelve el sistema al estado
actual sin tocar el 1 (que queda como código muerto inofensivo). No hay migraciones, ni estado
persistido, ni feature flags: el rollback es puramente de código.

Justificación de partirlo así: el commit 1 es un movimiento aditivo verificable en aislamiento; el 2
es el único con riesgo, y su diff queda tan chico que la revisión puede leerlo entero — que es
precisamente lo que hace confiable un refactor cuyo test más importante (§7.1) es débil.

**Precondición para arrancar:** correr `npm run test:integration` **antes** de tocar nada y
confirmar que la suite está verde en este entorno. Sin línea base, un fallo posterior no es
atribuible.
