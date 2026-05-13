# Cache — decisiones de diseño

Documento de referencia sobre cómo está construido el sistema de cache en esta API, por qué se eligió **composición** en vez de **herencia** para conectar los caches semánticos con el transporte, y por qué se aisló cada abstracción en la capa que la aloja. Si tocas el módulo de cache, lee esto antes.

> Convención: cuando el código y este doc disagree, gana el código — pero abre un PR para corregir el doc en el mismo cambio.

---

## 1. Mapa general

El sistema tiene **dos capas** apiladas, separadas por un puerto en cada nivel:

```
                          ┌─────────────────────────────────────────┐
   Capa semántica         │  IBudgetsCache                          │
   (qué se cachea)        │  ICategoriesCache                       │  puertos en
                          │  IUsersCache                            │  <modulo>/domain/ports/cache/
                          └────────────────────┬────────────────────┘
                                               │  has-a (constructor)
                                               ▼
                          ┌─────────────────────────────────────────┐
   Capa de transporte     │  ICacheStore                            │  puerto en
   (cómo se cachea)       │  get / set / del / delByPrefix          │  shared/domain/cache/
                          └────────────────────┬────────────────────┘
                                               │  implementa
                                               ▼
                          ┌─────────────────────────────────────────┐
                          │  RedisCacheStore (ioredis)              │  shared/infrastructure/cache/
                          └─────────────────────────────────────────┘
```

### Archivos

| Capa                  | Archivo                                                                              | Rol                                                  |
|-----------------------|--------------------------------------------------------------------------------------|------------------------------------------------------|
| Transporte (port)     | `src/shared/domain/cache/cache-store.port.ts`                                        | Contrato genérico key-value con TTL                  |
| Transporte (impl)     | `src/shared/infrastructure/cache/redis-cache-store.ts`                               | Único punto que conoce ioredis                       |
| Transporte (módulo)   | `src/shared/infrastructure/cache/cache.module.ts`                                    | `@Global()`. Bindea `ICacheStore` → `RedisCacheStore`|
| Semántico (port)      | `src/modules/<m>/domain/ports/cache/<m>-cache.port.ts`                               | Contrato de cache de ese agregado                    |
| Semántico (impl)      | `src/modules/<m>/infrastructure/cache/<m>-cache.impl.ts`                             | Mapea entidad ↔ shape y construye claves             |
| Test double           | `src/modules/<m>/infrastructure/cache/__fakes__/null-<m>-cache.ts`                   | Null Object (no-ops) para tests/feature flags        |

`<m>` ∈ { budgets, categories, users } al momento de escribir esto.

### Convenciones

- **Claves:** `<modulo>:<scope>:<id>` (`budgets:item:<uuid>`, `categories:user:<uuid>:list`, `budgets:user:<uuid>:list:<year>-<month>`).
- **Prefijo global:** `pf:` (configurable vía `REDIS_KEY_PREFIX`). Lo aplica `RedisCacheStore`; los caches de módulo NO ven el prefijo.
- **TTL:** 600 s (10 min) por defecto en cada impl. Constante local a cada archivo, no compartida — la duración es decisión semántica.
- **Serialización:** cada impl declara un `interface XxxCacheShape` y dos funciones `toShape` / `fromShape`. `fromShape` reconstruye usando `Entity.reconstitute(...)` y `VO.reconstitute(...)`, **nunca** `create(...)` — preserva timestamps y evita re-validación de datos persistidos (regla del `CLAUDE.md` §"Patrones que no cambian").
- **Invalidación:** dos modos:
  - `del(itemKey)` puntual cuando solo hay una clave que limpiar.
  - `delByPrefix(...)` cuando hay N listas por usuario (caso `budgets`, donde existe una lista por periodo `year-month`).

---

## 2. Por qué hay dos capas (qué se abstrajo y por qué)

El **único** lugar del código que `import`a `ioredis` es `redis-cache-store.ts`. Esa restricción no es estética — paga tres deudas concretas a la vez:

### 2.1. Regla de dependencia: el dominio no conoce vendors

Los archivos `*-cache.impl.ts` viven en `infrastructure/`, pero sus imports son todos a abstracciones de dominio (`ICacheStore`, la entidad, sus VOs). Si cada impl importara `ioredis`, el día que se cambie Redis por KeyDB / Dragonfly / Memcached / un cache in-process habría que tocar **N archivos** (uno por módulo). Hoy se toca **uno**: `redis-cache-store.ts`. El número de puntos de cambio es la métrica honesta de si una abstracción se gana su sitio.

### 2.2. La conexión a Redis es un recurso, no un valor

Redis no es "una librería más". Es un recurso con estado que debe ser **único en el proceso**:

| Recurso                          | Por qué debe ser único                                              |
|----------------------------------|---------------------------------------------------------------------|
| Pool de conexiones TCP           | Un pool por proceso, no uno por módulo                              |
| `keyPrefix` global               | Una fuente de verdad para namespacing                               |
| Política de reintentos           | `maxRetriesPerRequest: 3` homogénea para SLO predecible             |
| Lifecycle (`onModuleInit/Destroy`) | `ping` al arrancar, `disconnect` graceful al cerrar — una vez       |
| Métricas / tracing (futuro)      | Instrumentas el store una vez, todos los caches heredan observabilidad |

NestJS hace providers *singleton* por defecto, así que `RedisCacheStore` se instancia una sola vez y los caches de módulo comparten esa conexión. Sin el puerto intermedio, cada `XxxCacheImpl` haría su propio `new Redis(...)` y se perdería esa garantía.

### 2.3. Tests sin Redis, sin Docker, sin red

Cualquier test unitario de `BudgetsCacheImpl` mockea cuatro métodos:

```ts
const fakeStore: ICacheStore = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn(),
  del: jest.fn(),
  delByPrefix: jest.fn(),
};
const cache = new BudgetsCacheImpl(fakeStore);
```

Sin Redis levantado, sin contenedor, sin sorpresas. Y el `NullCategoriesCache` (`__fakes__/`) es trivial precisamente porque la **semántica** está desacoplada del **transporte**: implementa el puerto del módulo con no-ops y listo. Útil para flags "cache off" o tests que no quieren caché en absoluto.

### 2.4. La superficie del puerto es mínima y estable

```ts
// shared/domain/cache/cache-store.port.ts
export abstract class ICacheStore {
  abstract get<T>(key: string): Promise<T | null>;
  abstract set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  abstract del(key: string): Promise<void>;
  abstract delByPrefix(prefix: string): Promise<void>;
}
```

Cuatro métodos. Es el contrato mínimo que **cualquier** cache key-value soporta: Redis, Memcached, un `Map` con expiración en memoria, un decorador de métricas, un two-tier (L1 in-process + L2 distribuido). No filtra primitivas Redis-only (`MULTI`, `EVAL`, `SUBSCRIBE`, `XADD`) — y eso es intencional: ningún cache semántico de módulo debe necesitarlas. Si algún día una sí, ese caso es un puerto distinto, no este.

> **Regla heurística para evaluar puertos:** se justifica cuando la superficie de la abstracción es **más pequeña y más estable** que la superficie del concreto. `ICacheStore` tiene 4 métodos; `ioredis` exporta cientos. La diferencia es la promesa de estabilidad.

---

## 3. Por qué composición, no herencia

> La pregunta natural al leer el código es: *si ya existe `ICacheStore` en `shared/domain/`, ¿por qué `IBudgetsCache` no `extends ICacheStore`, como sí lo hace `IBudgetUnitOfWork extends IUnitOfWork`?*

La respuesta corta: porque la **relación semántica es distinta**. UoW es especialización ("is-a"); cache es colaboración ("has-a"). Lo que sigue es la versión rigurosa.

### 3.1. La prueba decisiva — ¿quién llama los métodos del puerto compartido?

| Puerto compartido | ¿Quién lo invoca?                                          | Resultado |
|-------------------|------------------------------------------------------------|-----------|
| `IUnitOfWork`     | El **caso de uso** (`uow.begin()`, `uow.commit()`, ...)    | Herencia  |
| `ICacheStore`     | **Solo la impl del cache** (`this.store.get(...)`). El caso de uso nunca lo ve. | Composición |

El use case que recibe `IBudgetUnitOfWork` **necesita** llamar `begin/commit/rollback`. El use case que recibe `IBudgetsCache` **no debe** llamar `get('algun-key-crudo')` — debe llamar `getListByUser(userId, options)`. La API de bajo nivel es propiedad privada de la impl.

Herencia **expone**; composición **oculta**. Para UoW queremos exponer. Para cache queremos ocultar.

### 3.2. UoW — el lifecycle sí es parte de la API pública

```ts
// shared/domain/IUnitOfWork.ts
export abstract class IUnitOfWork {
  abstract begin(): Promise<void>;
  abstract commit(): Promise<void>;
  abstract rollback(): Promise<void>;
  abstract release(): Promise<void>;
  abstract isActive(): boolean;
}

// modules/budgets/domain/IBudgetUnitOfWork.ts
export abstract class IBudgetUnitOfWork extends IUnitOfWork {
  abstract getBudgetRepository(): IBudgetRepository;
  abstract getScopedExpenseChecker(): IExpenseChecker;
}
```

El use case orquesta literalmente el ciclo de vida:

```ts
await uow.begin();
try {
  const repo = uow.getBudgetRepository();   // aporte específico del módulo
  // ...
  await uow.commit();
} catch (e) {
  await uow.rollback();
  throw e;
} finally {
  await uow.release();
}
```

`begin/commit/rollback` **no cambian entre módulos**. Son universales. Lo único que el módulo agrega son getters tipados a sus repos. La subclase **especializa sin reemplazar**. Eso es exactamente lo que la herencia modela bien.

### 3.3. Cache — el transporte NO es parte de la API pública

```ts
// modules/budgets/domain/ports/cache/budgets-cache.port.ts
export abstract class IBudgetsCache {
  abstract getListByUser(userId: string, options?: BudgetQueryOptions): Promise<Budget[] | null>;
  abstract setListByUser(...): Promise<void>;
  abstract getById(id: string): Promise<Budget | null>;
  abstract setById(budget: Budget): Promise<void>;
  abstract invalidateUser(userId: string): Promise<void>;
  abstract invalidateById(id: string): Promise<void>;
}
```

Estos métodos hablan de `Budget`, de `userId`, de "invalidar el usuario". El use case nunca debería construir una clave Redis a mano. Si hiciéramos `IBudgetsCache extends ICacheStore`:

```ts
class GetBudgetsByUserUseCase {
  constructor(private cache: IBudgetsCache) {}
  async execute(userId: string) {
    return this.cache.getListByUser(userId);     // ✓ semántico

    // pero TAMBIÉN compilaría:
    return this.cache.get('cualquier-cosa');     // ❌
    await this.cache.delByPrefix('budgets:');    // ❌ rompe invariantes
    await this.cache.set('mi-clave', x, 5);      // ❌ TTL fuera de control
  }
}
```

Eso es una **leaky abstraction** asegurada por construcción. La composición lo cierra: las únicas referencias a `ICacheStore` viven dentro de `BudgetsCacheImpl`. El use case no puede ni mencionar `get('...')` — el tipo no lo expone. Esto es **Interface Segregation Principle** aplicado de manera estricta.

### 3.4. Liskov — ambos lo cumplen formalmente, pero solo uno semánticamente

- **`IBudgetUnitOfWork` "is-a" `IUnitOfWork`**: verdadero. Un middleware genérico de tracing que mida tiempo entre `begin` y `commit` funcionaría con cualquiera de las dos. La especialización agrega capacidades sin alterar las existentes.
- **`IBudgetsCache` "is-a" `ICacheStore`**: falso. Un `IBudgetsCache` con `get('foo')` ¿retorna `Budget`? ¿Cualquier cosa? Las firmas son incompatibles a nivel de intención (`get<T>(key)` vs cosas tipadas a `Budget`). El cache de budgets *usa* un store; no *es* uno.

Esta es la versión rigurosa del "is-a vs has-a" coloquial.

### 3.5. Cardinalidad — UoW es 1:1, cache es N:1

**UoW.** Una clase concreta implementa varios puertos de módulo vía `useExisting` porque comparten el mismo `QueryRunner` request-scoped:

```ts
{ provide: TypeOrmUnitOfWorkImpl,  useClass: TypeOrmUnitOfWorkImpl, scope: Scope.REQUEST }
{ provide: ITransactionUnitOfWork, useExisting: TypeOrmUnitOfWorkImpl }
{ provide: IBudgetUnitOfWork,      useExisting: TypeOrmUnitOfWorkImpl }
{ provide: IAccountUnitOfWork,     useExisting: TypeOrmUnitOfWorkImpl }
```

La herencia múltiple de contratos modela exactamente esto: **distintas vistas tipadas sobre el mismo recurso transaccional**.

**Cache.** Un único recurso (`RedisCacheStore`) sirve a N caches semánticos:

```ts
{ provide: ICacheStore,      useExisting: RedisCacheStore }      // 1 cliente Redis
{ provide: IBudgetsCache,    useClass: BudgetsCacheImpl }
{ provide: ICategoriesCache, useClass: CategoriesCacheImpl }
{ provide: IUsersCache,      useClass: UsersCacheImpl }
```

Si `IBudgetsCache extends ICacheStore`, cada `XxxCacheImpl` pasaría a *ser-un* `ICacheStore` y el grafo de DI se volvería ambiguo (¿cuál se resuelve cuando se pide `ICacheStore`?). Composición elimina la ambigüedad: hay exactamente **un** `ICacheStore` en el container, y los caches semánticos lo consumen sin participar de su contrato.

### 3.6. Qué habilita cada elección hacia el futuro

**Herencia (UoW)** permite añadir un nuevo módulo transaccional creando un nuevo puerto que extiende `IUnitOfWork` con sus getters, y haciendo que `TypeOrmUnitOfWorkImpl` (o un nuevo impl) lo satisfaga. El use case del módulo nuevo recibe exactamente la superficie que necesita.

**Composición (cache)** permite **decoradores** (métricas, logs, two-tier L1+L2, circuit-breaker) sin tocar ningún cache de módulo:

```ts
{ provide: ICacheStore, useFactory: (redis, metrics) =>
    new MetricsCacheStore(new TwoTierCacheStore(new InMemoryStore(), redis), metrics) }
```

Cero cambios en `BudgetsCacheImpl`, `CategoriesCacheImpl`, `UsersCacheImpl`. Si hubieran heredado, decorar requeriría tocar cada cache de módulo individualmente.

---

## 4. Tabla de decisión — cuándo extender un puerto compartido y cuándo componerlo

Cuando dudes entre `extends SharedPort` y `constructor(private dep: SharedPort)`:

| Pregunta                                                                                | "Sí" implica       |
|-----------------------------------------------------------------------------------------|--------------------|
| ¿El consumidor del puerto de módulo necesita llamar los métodos del puerto compartido?  | **extends**        |
| ¿Los métodos del compartido son universales y se llaman *igual* en todos los módulos?   | **extends**        |
| ¿Los métodos del compartido son primitivas de bajo nivel que el módulo encapsula?       | **composición**    |
| ¿Hay N puertos de módulo compartiendo *una* instancia del recurso compartido?           | **composición**    |

- **UoW:** sí, sí, no, no → **herencia**.
- **Cache:** no, no, sí, sí → **composición**.

---

## 5. Reglas para quien toque el módulo

- **No** importes `ioredis` fuera de `redis-cache-store.ts`. Si necesitas una primitiva nueva, agrégala a `ICacheStore` (y a la impl), no la llames desde un cache de módulo.
- **No** uses `ICacheStore` directamente desde un use case. Pasa por el puerto semántico (`IBudgetsCache`, etc.) o crea uno nuevo si el caso lo amerita.
- **No** llames `Entity.create()` ni `VO.create()` dentro de `fromShape`. Usa `reconstitute(...)` siempre — el dato persistido ya fue validado en su momento.
- **No** mezcles claves entre módulos. El prefijo de cada módulo (`budgets:`, `categories:`, `users:`) es propiedad de ese módulo; no las construyas desde otro lado.
- **No** dependas del prefijo global `pf:` dentro de los caches semánticos. Lo aplica `RedisCacheStore`; trabajar contra él rompe la invariante de que solo un archivo conoce el namespacing.
- **No** subas el TTL sin razón documentada. Hoy es 600 s en los tres impls; si cambias uno, escribe el porqué en el commit y considera si los demás también deben moverse.
- **Sí** añade un puerto de cache para un módulo nuevo replicando la plantilla: puerto en `<modulo>/domain/ports/cache/`, impl en `<modulo>/infrastructure/cache/`, null-object en `__fakes__/`. Bindeo en el `Module` del módulo.

---

## 6. Resumen en una frase

> **Hereda para especializar contratos (`IBudgetUnitOfWork extends IUnitOfWork`); compón para reutilizar comportamiento (`BudgetsCacheImpl` recibe `ICacheStore`).**

En este repo, la herencia se reserva a contratos cuya superficie completa **debe ser visible** al consumidor del puerto de módulo. La composición se aplica cuando lo que se reutiliza es un recurso o primitiva que **debe permanecer oculto** detrás de una API semántica de más alto nivel. Esa distinción es lo que mantiene las capas del proyecto habitables a largo plazo.
