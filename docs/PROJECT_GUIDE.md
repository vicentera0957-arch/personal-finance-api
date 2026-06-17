# Project Guide — Personal Finance API

Documento maestro para **entender el proyecto en cada parte**. Es el punto de entrada:
empezá acá y seguí los enlaces según lo que necesites. Pensado tanto para vos en 6 meses
como para alguien que llega por primera vez (o un recruiter revisando el repo).

> **Por qué existe este doc:** `CLAUDE.md` (la referencia exhaustiva para IA) está
> gitignored, así que **este** es el documento de arquitectura versionado del repo.

---

## 1. Qué es esto

API REST de finanzas personales: un usuario registra **cuentas**, define **categorías**
(ingreso/gasto), fija **presupuestos** mensuales por categoría, y registra **transacciones**
que mueven el balance de sus cuentas respetando los límites de presupuesto.

- **Stack:** NestJS 11 · TypeORM · PostgreSQL 15 · JWT (access + refresh con rotación) · Redis (cache + rate-limit).
- **Estilo:** Domain-Driven Design estricto, Ports & Adapters, Unit of Work con locks pesimistas.
- **Estado:** dominio y seguridad maduros; listo para un primer deploy (ver §7).

Diagramas de referencia:
- 🖼️ [Diagrama de capas](./architecture/layer_diagram.svg) · [Diagrama de módulos](./architecture/modules_diagram.svg)
- [Modelo de datos (PDF)](./database/Finanzas%20V1.pdf)
- [Reglas de negocio (PDF)](./domain/Reglas%20de%20negocio.docx.pdf)

---

## 2. Mapa de la documentación

| Necesitás… | Leé |
|---|---|
| Arrancar el proyecto en local | [`README.md`](../README.md) |
| Entender la arquitectura completa (este doc) | **PROJECT_GUIDE.md** |
| Referencia exhaustiva (patrones, tablas, anti-patrones) | `CLAUDE.md` *(gitignored, local)* |
| Detalle vivo de un módulo | `src/modules/<m>/notes.md` |
| Por qué el cache usa composición y no herencia | [`src/shared/domain/cache-decision.md`](../src/shared/domain/cache-decision.md) |
| Por qué el UoW usa herencia de puertos | [`src/shared/domain/uow-decision.md`](../src/shared/domain/uow-decision.md) |
| Cómo desplegar (build/release/run, env vars, health) | [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) |
| Historial de endurecimiento (journal, abr-2026) | [`docs/HARDENING_AUDIT_2026-04.md`](./HARDENING_AUDIT_2026-04.md) |
| Cómo se cerraron las race conditions (journal, may-2026) | [`docs/race-conditions-fix-2026-05.md`](./race-conditions-fix-2026-05.md) |

---

## 3. Arquitectura en tres capas

Cada módulo (`auth`, `users`, `accounts`, `categories`, `budgets`, `transactions`) tiene
la misma esqueleto:

```
src/modules/<module>/
  domain/           # PURO: sin NestJS, sin TypeORM, sin HTTP
    entities/         # entidades ricas, constructor privado, factories create()/reconstitute()
    value-objects/    # inmutables, auto-validantes
    exceptions/       # subclases de Error (NO HttpException)
    repository/       # puertos (abstract class)
  application/
    use-cases/        # una clase por caso de uso, un execute()
    schedulers/       # @Cron (solo auth hoy)
  infrastructure/
    persistence/      # ORM entity, mapper, repo impl, UoW impl
    http/             # controllers + DTOs (class-validator)
    adapters/         # bcrypt, JWT, etc.
```

**La regla de oro:** las dependencias apuntan hacia adentro. `domain` no conoce a nadie;
`application` conoce `domain`; `infrastructure` conoce a ambos. El dominio nunca importa
TypeORM ni HTTP.

### Por qué los puertos son `abstract class` y no `interface`

NestJS necesita un **token en runtime** para inyectar. Una `interface` de TypeScript se borra
al compilar → no sirve como token. Por eso los puertos (repositorios, UoW, caches) son
`abstract class`: funcionan como tipo *y* como token DI. Cambiarlos a `interface` rompe el
grafo de inyección. (Detalle ampliado en `cache-decision.md`.)

### Jerarquía y dependencias entre módulos

```
auth → users → (accounts, categories, budgets, transactions)
```

- `auth` usa `users` (login/register llaman a casos de uso de users).
- Dentro de los módulos de finanzas: **transactions → budgets → categories → accounts**.
- Hay un ciclo `accounts ↔ transactions` resuelto con `forwardRef()` + el patrón
  **"port owned by consumer"**: cuando A necesita preguntarle algo a B pero B ya depende de A,
  el *puerto* se define en el dominio de A y la *implementación* en la infraestructura de B
  (ej. `IExpenseChecker`, `IAccountUnitOfWork`).

---

## 4. Patrones que no cambian

| Patrón | Qué es | Por qué |
|---|---|---|
| **Factory methods** | `Entity.create(props)` (nuevo) vs `Entity.reconstitute(props)` (desde DB) | `create` genera timestamps y valida; `reconstitute` preserva timestamps y no re-valida. Los mappers usan **siempre** `reconstitute`. |
| **Value Objects** | Inmutables, validan en `create`, no en `reconstitute` | Una vez creado, es válido. Nunca se guarda un VO inválido. |
| **Excepciones de dominio** | El dominio lanza `BudgetNotFoundException extends Error`, no `NotFoundException` | El dominio no sabe de HTTP. El **controller** traduce con `instanceof` → código HTTP. |
| **`userId` desde `@CurrentUser()`** | El actor sale del JWT, nunca del body/URL | Regla de seguridad: un body con `userId:'X'` es un intento de actuar como X. Se confía solo en el JWT. |
| **Defensa en profundidad** | Unique en DB + `catch 23505` → excepción de dominio + pre-check en use case | Tres capas para cada regla de unicidad. |

---

## 5. Concurrencia: Unit of Work + locks pesimistas

El corazón técnico del proyecto. Toda invariante que cruza varios agregados (balance de cuenta,
límite de presupuesto, suma de gastos del período) se protege con una **transacción de DB +
`SELECT ... FOR UPDATE`**.

**Idea central:** cada request HTTP que muta varios agregados abre un `IUnitOfWork`
(request-scoped) → un único `QueryRunner` → una única transacción PostgreSQL. Los repositorios
"escopados" que entrega el UoW comparten ese `EntityManager`, así que los locks pesimistas son
efectivos a lo largo de toda la secuencia lee→valida→escribe.

```
Use case → uow.begin() → repos escopados (FOR UPDATE) → dominio → uow.commit()
                                                                 ↘ catch → uow.rollback()
                                                                 ↘ finally → uow.release()
```

- Una sola clase (`TypeOrmUnitOfWorkImpl`, en `transactions/infrastructure/`) satisface tres
  puertos de módulo (`ITransactionUnitOfWork`, `IBudgetUnitOfWork`, `IAccountUnitOfWork`)
  vía `useExisting` → la misma instancia y transacción por request.
- `auth` tiene su propio UoW (`AuthUnitOfWorkImpl`) porque su frontera (rotación de refresh
  tokens) no comparte invariante con los agregados financieros.
- La **fila del budget funciona como mutex lógico** del invariante "Σ gastos del período ≤ límite":
  todo flujo que toque ese invariante lockea esa fila primero.

**Profundizar:** `uow-decision.md` (jerarquía de puertos), `race-conditions-fix-2026-05.md`
(diagramas TOCTOU de las races cerradas), y la sección "Concurrency" de `CLAUDE.md` (tabla
completa de locks). El diagrama E2E paso a paso está en el plan
`~/.claude/plans/planifica-que-falta-para-vectorized-lecun.md`.

---

## 6. Autenticación

- **Access token** (15 min, `JWT_SECRET`) stateless; **refresh token** (7 días,
  `JWT_REFRESH_SECRET`) persistido en `refresh_tokens` (solo `sha256(token)`, nunca el plano).
- **Rotación con detección de replay:** cada `/auth/refresh` invalida el token viejo y emite uno
  nuevo en la misma *familia*. Si llega un token ya rotado → se revoca **toda la familia**
  (`UPDATE … WHERE family_id = $1`) y se rechaza. Cierre de sesión real vía `/auth/logout`.
- **Login timing-safe:** corre `bcrypt.compare` aun cuando el email no existe (contra un hash
  dummy) y devuelve un error genérico → no filtra qué emails están registrados.
- **Guard global** `JwtAuthGuard` (deny-by-default); `@Public()` libera rutas (`/auth/*`,
  `/health`, `/ready`). Rate-limit estricto (5/min) en `/auth/*`.

Referencia viva: `src/modules/auth/notes.md`.

---

## 7. Deploy

El empaquetado y el contrato con la plataforma están implementados; ver el runbook completo en
[`docs/DEPLOYMENT.md`](./DEPLOYMENT.md). Resumen del modelo **Build → Release → Run**:

- **Build:** `Dockerfile` multi-stage → imagen mínima con `dist/` + deps de prod (usuario no-root, `tini`).
- **Release:** `docker-entrypoint.sh` corre `migration:run` (sobre `dist/data-source.js`) antes de arrancar.
- **Run:** `node dist/main.js`, con `enableShutdownHooks()` para cierre limpio en SIGTERM.
- **Config:** validada por Joi al arrancar; en prod la app **no arranca** si falta un secret o si `CORS_ORIGIN='*'`.
- **Health:** `/health` (liveness) y `/ready` (readiness, valida la DB con Terminus).

---

## 8. Testing

```bash
npm test                  # unit (domain + use cases), sin DB
npm run test:integration  # integración con Postgres real (test/.env.test)
npm run test:cov          # cobertura
```

- **Unit:** ~593 tests, dominio y casos de uso cubiertos con fakes in-memory.
- **Integración:** suite contra Postgres real (hoy los specs están como `.bak` — reactivarlos es
  el próximo hito de testing; ver §9).
- CI (`.github/workflows/ci.yml`): jobs de `lint`, `build`, unit, integración y *migration smoke*
  (corre las migraciones desde cero para detectar un schema inicial incompleto).

---

## 9. Estado y qué falta

**Sólido hoy:** dominio, concurrencia (races cerradas), auth con rotación, migraciones
consolidadas en una sola `InitialSchema`, bootstrap endurecido, empaquetado de deploy verificado E2E.

**Pendiente (no bloquea el primer deploy):**
1. Reactivar los integration tests (`test/integration/*.bak`) y que CI falle si fallan.
2. Hacer el primer deploy real (PaaS) y enlazar la URL viva + Swagger en el README.
3. Observabilidad: métricas (Prometheus) + tracing + error tracking (Sentry).
4. Índice parcial `WHERE nature='expense'` (optimización; ojo con el drift entity↔DB).

---

## 10. Comandos de un vistazo

```bash
npm run start:dev          # desarrollo con hot-reload
npm run build              # compila a dist/
npm run lint               # eslint
npm test                   # tests unitarios
npm run migration:run      # aplica migraciones (dev, ts-node)
npm run migration:generate # genera migración desde el diff de entities
docker compose up -d       # Postgres (5433) + Redis + pgAdmin (5050)
docker build -t personal-finance-api .   # imagen de producción
```
