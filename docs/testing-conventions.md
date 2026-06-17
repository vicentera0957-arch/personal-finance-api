# Convención de tests

> **Decisión 1 (idioma) — RESUELTA y APLICADA (2026-06-15): inglés en todos los tests.**
> Los 8 integration specs se tradujeron a inglés conservando la estructura de
> `transactions.integration.spec.ts`, y los 3 unit outliers en español se pasaron a inglés. Suite
> completa verde tras el cambio: **unit 593/593 (68 suites) + integration 61/61 (8 suites)**.
>
> **Decisión 2 (estrategia de dobles) — RESUELTA y APLICADA (2026-06-15).** Regla: **fakes InMemory
> para puertos con estado** (repos, UoW), **`jest.fn` para adapters finos** (hasher, token provider).
> Se crearon `InMemoryRefreshTokenRepository` e `InMemoryAuthUnitOfWork`, y los 4 use cases de auth
> (login, register, logout, refresh-token) se migraron de `jest.fn` a estos fakes. Suite verde:
> unit 593/593, integration 61/61.

## Auditoría (2026-06-15)

| Dimensión | Estado |
| --- | --- |
| Specs unit (`src/**/*.spec.ts`) | 68 |
| Specs integración (`test/integration/**/*.integration.spec.ts`) | 8 |
| e2e (`test/app.e2e-spec.ts`) | 1 |
| **Idioma — unit** | 64/68 en inglés (`it('should …')`); **3 outliers en español** |
| **Idioma — integración** | 8/8 en español (`describe('Cuentas: …')`, `it('produce el balance …')`) |
| **Dobles — InMemory fakes** (`__fakes__/`) | 31 specs |
| **Dobles — `jest.fn` / mocks** | 24 specs |
| Setup | `beforeEach` consistente; AAA implícito (no etiquetado) |

**Las dos inconsistencias reales:**
1. **Idioma mezclado**: unit en inglés, integración en español. (Dentro de unit hay 3 outliers en español.)
2. **Estrategia de dobles mezclada**: ~mitad fakes InMemory, ~mitad `jest.fn`. Sin regla de cuándo usar cuál.

Todo lo demás (naming `subject` → `behavior`, `beforeEach`, un assert-objetivo por caso) ya es bastante
consistente — la base es buena.

---

## Decisiones que necesito de ti

### Decisión 1 — Idioma de los tests → RESUELTA: inglés en todo

Elegida la opción A (inglés en todos los tests) y **ya aplicada**. Todos los `describe`/`it`/comentarios
están en inglés. Los datos de dominio (`'corriente'`, `'expense'`, `'income'`) se mantienen como están
(son valores del dominio, no etiquetas).

### Decisión 2 — Estrategia de dobles → RESUELTA: regla aplicada

Regla:
- **Repositorios y puertos con comportamiento** (`IXRepository`, `IUnitOfWork`, `IExpenseChecker`) →
  **fake InMemory** en `__fakes__/`. Más mantenible, captura comportamiento real (ej. unicidad,
  `revokeFamily` mutando la familia), y no se rompe al reordenar llamadas.
- **Adapters finos y colaboradores de una sola llamada** (`IPasswordHasher`, `ITokenProvider`) →
  **`jest.fn`**. Mockear un fake completo sería sobre-ingeniería.

**Excepción — aserciones de interacción:** cuando lo que importa es *si una llamada ocurrió o no*
(idempotencia: "no llama a `save` si ya está revocado"; fail-fast: "no consulta la DB si la firma
falla"), se usa `jest.spyOn(fake, 'método')` **sobre el fake**. Así se conserva el estado del fake y se
afirma la interacción puntual donde de verdad es el punto del test. Ver `logout.use-case.spec.ts`.

**Fakes disponibles** (`__fakes__/` por módulo): `InMemoryAccountRepository`, `InMemoryBudgetRepository`,
`InMemoryCategoryRepository`, `InMemoryTransactionRepository`, `InMemoryUserRepository`,
`InMemoryUnitOfWork` (transactions/budgets), `InMemoryRefreshTokenRepository`, `InMemoryAuthUnitOfWork`.

---

## Convención

### Unit tests (`src/**/*.spec.ts`) — convención de facto, ahora formalizada

- **Idioma:** inglés.
- `describe('<Subject>')` = la clase/VO/entidad bajo prueba (`'CreateAccountUseCase'`, `'AmountLimit'`,
  `'Transaction Entity'`).
- Para VOs/entidades, `describe` anidado por método (`describe('create()')`, `describe('reconstitute()')`).
- `it('<behavior>')` describe comportamiento observable, no implementación.
- `beforeEach` instancia el SUT y sus dobles.
- **Dobles:** según la Decisión 2 (pendiente). Hoy conviven fakes InMemory y `jest.fn`.
- Sin DB, sin HTTP — todo en memoria.

### Integration tests (`test/integration/**/*.integration.spec.ts`) — plantilla `transactions`

La estructura de referencia es `transactions.integration.spec.ts`:
- `describe` raíz: `'<Domain>: <invariantes/contrato contra la DB real>'`.
- `beforeAll`/`afterAll` (app), `beforeEach` con `cleanDatabase` + setup de fixtures.
- Banners `// ===` por endpoint/regla, con una línea del **por qué** es integración (vs unit).
- `describe('<verbo o regla>')` → `it('<behavior>')`.
- Comentarios inline para la aritmética (`// 5000 - 100 - 200 -> 4700`).
- Para concurrencia: `Promise.all` + aserción sobre estado final derivado + `not.toBe(500)`.
- Smoke de ownership al final (401 sin token).

### Estructura de archivo (genérica)

```
describe('<Subject>', () => {        // la clase/VO/endpoint bajo prueba
  // setup compartido en beforeEach (fakes, instancias)
  describe('<método o escenario>', () => {   // opcional, agrupa por método (ver VOs)
    it('<behavior esperado>', () => {
      // Arrange — preparar entrada y estado
      // Act — ejecutar la unidad
      // Assert — verificar salida/estado/excepción
    });
  });
});
```

### Reglas

1. **Naming**: `describe` = sujeto (`CreateTransactionUseCase`, `AmountLimit`); `it` = comportamiento
   observable, no implementación (`'rejects an expense over the budget limit'`, no `'calls findById'`).
2. **Un comportamiento por `it`.** Si el título lleva "and", probablemente son dos casos.
3. **AAA explícito** con comentarios `// Arrange / // Act / // Assert` solo cuando el test es largo;
   en tests de 3 líneas el patrón es obvio y el comentario es ruido.
4. **Dobles**: según la Decisión 2.
5. **Integración**: DB real vía `createTestApp`, `cleanDatabase` en `beforeEach`, supertest. Para
   concurrencia: `Promise.all` + aserción sobre **estado final derivado** (no solo status) + `not.toBe(500)`.
6. **Sin lógica condicional en los tests** (`if`/`for` que cambien aserciones) salvo el patrón de race
   con dos desenlaces válidos, que se documenta inline.

### Migración (no big-bang)

1. Arreglar los **3 outliers de idioma** en unit (rápido, sin discusión una vez elegido el idioma).
2. Aplicar la regla de dobles solo cuando se toque un spec por otra razón (no refactor masivo).
3. Nuevos specs nacen con la convención.

> Filosofía: la consistencia se alcanza **incrementalmente y al tocar**, no con un PR gigante que
> arriesga romper 68 archivos de una vez. La convención escrita es la que guía a los nuevos.
