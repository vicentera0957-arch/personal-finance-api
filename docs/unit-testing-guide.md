# Guía de testing unitario — desde cero

> Solo **tests unitarios** (sin DB, sin HTTP). Para integración ver
> [testing-conventions.md](./testing-conventions.md) y [concurrency-model.md](./concurrency-model.md §12).
> Esta guía explica **qué se prueba, cómo, con qué dobles, y cómo leer/escribir uno nuevo**.

---

## 0. Mapa mental en una imagen

```
        /\
       /  \   Integración → Postgres real + HTTP real + locks reales
      /----\                Prueba el CABLEADO y lo que solo la DB demuestra
     /      \
    /  Unit  \  Unit → sin DB, sin HTTP, con dobles. Rápido (ms).
   /----------\          Prueba TU LÓGICA en aislamiento.
```

**Regla de oro:** un test unitario prueba **una decisión que tú escribiste**. Si necesita una DB, está
mal ubicado. Si solo verifica "el framework hace lo suyo" (que el ORM guarda), es ruido — eso lo cubre
integración.

> **Cobertura por riesgo, no por método.** No escribas un test por cada método público; escribe tests
> donde hay lógica que puede romperse en silencio.

---

## 1. Las 3 capas y cómo se prueba cada una

| Capa | Qué prueba | Dobles | Ejemplo de archivo |
| --- | --- | --- | --- |
| **Domain** (entities, VOs) | invariantes, lógica pura | **ninguno** | `amount.vo.spec.ts`, `transaction.entity.spec.ts` |
| **Application** (use cases) | orquestación: lee→decide→escribe→commit | **fakes InMemory** (+ `jest.fn` para adapters finos) | `create-account.use-case.spec.ts`, `refresh-token.use-case.spec.ts` |
| **Infrastructure** | mappers, traducción de error de repos, mapeo excepción→HTTP de controllers | `jest.fn` o construcción directa | `account.mapper.spec.ts`, `account.repo.implement.spec.ts`, `accounts.controller.spec.ts` |

---

## 2. Sintaxis de Jest — decodificador

Todo test usa este vocabulario. Apréndelo una vez:

```ts
describe('Subject', () => {           // agrupa: la clase/VO bajo prueba
  beforeEach(() => { /* setup */ });  // corre antes de CADA it
  it('does X', () => {                // un caso de comportamiento
    expect(actual).toBe(expected);    // aserción
  });
});
```

**Aserciones más usadas:**
```ts
expect(x).toBe(y)                   // igualdad estricta (===), para primitivos
expect(obj).toEqual(y)              // igualdad profunda, para objetos/arrays
expect(obj).toHaveProperty('k', v)  // tiene la propiedad con ese valor
expect(arr).toHaveLength(3)
expect(fn).toThrow(SomeException)               // función SÍNCRONA que lanza
await expect(promise).rejects.toThrow(Exc)      // función ASÍNCRONA que rechaza
expect(x).toBeNull() / toBeDefined() / toBe(true)
expect(str).toMatch(/regex/)
```

**`jest.fn` (mock/stub) — un títere que registra llamadas:**
```ts
const fn = jest.fn();              // devuelve undefined por defecto, registra cada llamada
fn.mockReturnValue(x);             // "cuando te llamen, devuelve x" (síncrono)
fn.mockResolvedValue(x);           // "...devuelve Promise<x>" (async, = return)
fn.mockRejectedValue(err);         // "...rechaza con err" (async, = throw)
fn.mockImplementation(a => a);     // "ejecuta esta función"
expect(fn).toHaveBeenCalledWith(arg);    // ¿te llamaron con arg?
expect(fn).toHaveBeenCalledTimes(1);
expect(fn).not.toHaveBeenCalled();
```

**`jest.spyOn` — espía un método de un objeto REAL (ej. un fake):**
```ts
const spy = jest.spyOn(fakeRepo, 'save');   // observa sin reemplazar el comportamiento
expect(spy).not.toHaveBeenCalled();
```

---

## 3. Los dobles de test — la decisión clave

### La regla

| Colaborador | Doble | Por qué |
| --- | --- | --- |
| Repos / puertos **con estado** (`IXRepository`, `IUnitOfWork`, `IExpenseChecker`) | **fake InMemory** | tiene memoria: `save` y luego `find` devuelve lo guardado; el test se lee como historia |
| Adapters finos de **una llamada** (`IPasswordHasher`, `ITokenProvider`) | **`jest.fn`** | mockear un fake completo sería sobre-ingeniería |
| Cuando el punto del test **es la interacción** (idempotencia, fail-fast) | **`jest.spyOn` sobre el fake** | conserva el estado del fake + afirma "se llamó / no se llamó" |

### Por qué fakes y no mocks (lo más importante)

Un `jest.fn` **no tiene memoria**. Para un use case que hace varios pasos (find → modify → save → quizá
find de nuevo), con mocks tendrías que *scriptear cada retorno a mano* y afirmar el orden de llamadas:
frágil (se rompe en refactors inofensivos) y prueba *implementación*, no *comportamiento*.

Un **fake InMemory** es una implementación real respaldada por un `Map`:

```ts
// in-memory-account.repository.ts — extends EL MISMO puerto que la impl real
export class InMemoryAccountRepository extends IAccountRepository {
  private store = new Map<string, Account>();
  async findById(id)   { return this.store.get(id) ?? null; }
  async save(account)  { this.store.set(account.id, account); return account; }
  seed(accounts)       { for (const a of accounts) this.store.set(a.id, a); } // ARRANGE
  size()               { return this.store.size; }                            // ASSERT
}
```

Se comporta como el repo real, pero sin DB. Lo escribes **una vez por puerto** y lo reusas en todos los
use cases del módulo (7-8 specs) → se amortiza.

### Fakes disponibles (`__fakes__/` por módulo)

`InMemoryAccountRepository`, `InMemoryBudgetRepository`, `InMemoryCategoryRepository`,
`InMemoryTransactionRepository`, `InMemoryUserRepository`, `InMemoryUnitOfWork` (transactions/budgets),
`InMemoryRefreshTokenRepository`, `InMemoryAuthUnitOfWork`.

El **UoW fake** además **cuenta** commits/rollbacks (no hay locks reales — eso es integración):

```ts
expect(uow.commits()).toBe(1);     // ¿committeó una vez?
expect(uow.rollbacks()).toBe(0);   // ¿no hizo rollback?
```

### Test support — factories

`src/test-support/factories` (`makeAccount`, `makeUser`, …): construyen entidades de dominio válidas en
una línea, para que el ARRANGE no reescriba todas las props.

```ts
userRepo.seed([makeUser({ email: 'a@b.cl', passwordHash: 'hashed' })]);
```

---

## 4. La forma recurrente: Arrange · Act · Assert

Todo `it` tiene 3 fases (a veces sin etiquetas, porque en tests cortos es obvio):

```ts
it('reduces the balance on an expense', async () => {
  // Arrange — estado + dobles
  repo.seed([makeAccount({ id: 'a1', currentBalance: 1000 })]);

  // Act — ejecutar la unidad bajo prueba
  await useCase.execute({ accountId: 'a1', amount: 200, nature: 'expense' });

  // Assert — salida / estado del fake / excepción
  const after = await repo.findById('a1');
  expect(after?.getCurrentBalance().getValue()).toBe(800);
});
```

**Naming:** `describe('<Subject>')` → (opcional `describe('<método>')`) → `it('<comportamiento>')`, en
inglés, describiendo el comportamiento observable, no la implementación.

---

## 5. Un ejemplo por capa (anotado)

### 5.1 Domain — value object (pura lógica, sin dobles)

```ts
describe('AmountLimit', () => {
  describe('create', () => {
    it('should create an amount limit with positive integer', () => {
      expect(AmountLimit.create(1000).getValue()).toBe(1000);
    });
    it('should throw InvalidAmountLimitException if amount is not integer', () => {
      expect(() => AmountLimit.create(1.5)).toThrow(InvalidAmountLimitException);
    });
  });
});
```
No hay dependencias → no hay nada que mockear. Solo entrada → salida/excepción.

### 5.2 Application — use case simple (fake con estado)

```ts
describe('CreateAccountUseCase', () => {
  let repo: InMemoryAccountRepository;
  let useCase: CreateAccountUseCase;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();      // doble con estado
    useCase = new CreateAccountUseCase(repo);    // SUT con el puerto inyectado
  });

  it('should persist a new account ...', async () => {
    const result = await useCase.execute({ userId: 'u1', name: 'Main', type: 'corriente', initialBalance: 500 });
    expect(result.getCurrentBalance().getValue()).toBe(500);  // salida
    expect(repo.size()).toBe(1);                              // estado del fake
  });
});
```

### 5.3 Application — use case con UoW (fakes + estado + commits)

Del `refresh-token.use-case.spec.ts` (la rotación):

```ts
beforeEach(() => {
  repo = new InMemoryRefreshTokenRepository();
  uow  = new InMemoryAuthUnitOfWork(repo);       // el UoW devuelve ESTE repo
  tokenProvider = { generateRefreshToken: jest.fn().mockResolvedValue('new-refresh'), /* … */ };
  useCase = new RefreshTokenUseCase(tokenProvider, uow);
});

it('rotates correctly: invalidates the old one and issues a new pair', async () => {
  repo.seed([makeToken('old-refresh-token')]);                 // hash real: sha256(raw)
  tokenProvider.verifyRefreshToken.mockResolvedValue({ sub: 'user-1', email: 'a@b.cl', jti: 'jti-1' });

  const result = await useCase.execute('old-refresh-token');

  expect(uow.commits()).toBe(1);                               // coreografía transaccional
  const old = await repo.findByTokenHash(sha256('old-refresh-token'));
  expect(old?.isRevoked()).toBe(true);                         // estado: viejo revocado
  expect(repo.size()).toBe(2);                                 // viejo + nuevo persistidos
});
```
Fíjate: se afirma **estado** ("el viejo quedó revocado", "hay 2 tokens") y la **coreografía** (commits),
no "se llamó a save". Para la búsqueda por hash, el seed usa `sha256(raw)` real → ejercita el hashing.

### 5.4 Application — aserción de interacción (spyOn sobre el fake)

Del `logout.use-case.spec.ts` (idempotencia: NO debe escribir si ya está revocado):

```ts
it('is idempotent: does not call save if already revoked', async () => {
  repo.seed([makeToken('already-revoked-token', { revoked: true })]);
  const saveSpy = jest.spyOn(repo, 'save');     // observa el fake
  await useCase.execute('already-revoked-token');
  expect(saveSpy).not.toHaveBeenCalled();        // el punto del test ES la interacción
});
```

### 5.5 Infrastructure — mapper (transformación pura)

```ts
it('toDomain reconstitutes preserving timestamps', () => {
  const orm = buildOrmEntity({ createdAt: new Date('2026-01-01') });
  const domain = mapper.toDomain(orm);
  expect(domain.createdAt).toEqual(new Date('2026-01-01')); // usa reconstitute(), no create()
});
```
Sin dobles: construyes un ORM obj, mapeas, afirmas. Prueba **tu** transformación (la decisión
`reconstitute` vs `create`, nullables, columnas) — no el ORM.

### 5.6 Infrastructure — repo impl (señal vs ruido)

Del `account.repo.implement.spec.ts`. Aquí conviven los dos:

```ts
// ⚠️ RUIDO (pass-through): afirma que llamaste al ORM como lo llamaste. Casi tautológico.
it('should return domain Account when found', async () => {
  ormRepo.findOne.mockResolvedValue(buildOrm());
  await repo.findById('a1');
  expect(ormRepo.findOne).toHaveBeenCalledWith({ where: { id: 'a1' } });
});

// ✅ SEÑAL (traducción de error): lógica de defense-in-depth que el repo posee.
it('should translate Postgres FK violation (23503) into AccountInUseException', async () => {
  ormRepo.delete.mockRejectedValue({ code: '23503' });
  await expect(repo.delete('a1')).rejects.toThrow(AccountInUseException);
});
```
El ORM se mockea con `jest.fn` (no tiene estado que nos importe aquí). Lo valioso es la traducción de
error; el round-trip real lo prueba integración.

### 5.7 Infrastructure — controller (excepción de dominio → HTTP)

Del `accounts.controller.spec.ts`. Mockea los **use cases** con `jest.fn` y prueba el contrato HTTP:

```ts
it('maps AccountNotFoundException to 404', async () => {
  getByIdUseCase.execute.mockRejectedValue(new AccountNotFoundException('x'));
  await expect(controller.findOne('x', currentUser)).rejects.toThrow(NotFoundException);
});
```
Esto es la **única fuente de verdad** del mapeo excepción→HTTP (ver la tabla en CLAUDE.md). Un mapeo
faltante se fuga como 500 — por eso vale.

---

## 6. Receta para escribir un test unitario nuevo

1. **¿Qué capa?** Domain → sin dobles. Application → fakes. Infra → según el tipo.
2. **`describe('<Subject>')`** con el nombre de la clase/VO.
3. **`beforeEach`**: construye el SUT inyectando dobles (fakes para puertos con estado, `jest.fn` para
   adapters).
4. **Un `it` por comportamiento**, nombre en inglés que describa el *qué*.
5. **Arrange** (seed del fake / mock de adapters) → **Act** (llamar) → **Assert** (estado del fake /
   salida / excepción).
6. **¿La interacción ES el punto?** (idempotencia, fail-fast) → `jest.spyOn` sobre el fake.
7. Pregúntate: *¿esto prueba una decisión mía, o reenvío a un framework?* Si es reenvío puro, no lo
   escribas — lo cubre integración.

---

## 7. Qué NO cubren los tests unitarios (→ integración)

- **Locks pesimistas / concurrencia** — los fakes no tienen `FOR UPDATE`; el UoW fake solo cuenta
  commits. Las races se prueban contra Postgres real.
- **FKs, unique constraints, `catch 23505/23503` de verdad** — el unit prueba la *traducción* del error;
  que el error *ocurra* lo prueba la DB real.
- **Migraciones / esquema** — solo integración corre las migraciones.
- **Cableado HTTP real, guard global, prefijo, validación de DTO end-to-end.**
- **`not.toBe(500)`** — esa aserción solo tiene sentido en integración (un 500 = inconsistencia real).

---

## 8. Comandos

```
npm test                                  # todos los unit tests
npm test -- --testPathPattern "accounts"  # solo specs cuyo path matchea
npm test -- --watch                       # modo watch (re-corre al guardar)
npm test -- --coverage                    # reporte de cobertura
npm test -- -t "rotates correctly"        # solo tests cuyo nombre matchea (testNamePattern)
```

> Unit usa la config jest de `package.json` (rootDir `src`). Integración usa
> `test/jest-integration.json` vía `npm run test:integration` (necesita Postgres + Redis).

---

## 9. Convención (resumen normativo)

- **Idioma:** inglés en `describe`/`it`/comentarios.
- **Naming:** `describe` = sujeto; `describe` anidado por método en VOs/entities; `it` = comportamiento.
- **Dobles:** fake InMemory para puertos con estado; `jest.fn` para adapters finos; `spyOn` sobre el
  fake para aserciones de interacción.
- **Un comportamiento por `it`** (si el título lleva "and", probablemente son dos).
- **Cobertura por riesgo:** no testear pass-through al ORM en unit.

Estado actual: **593 tests unitarios, 68 suites, todos verdes.**