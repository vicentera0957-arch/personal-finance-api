# Personal Finance API

NestJS + TypeORM REST API para gestión de finanzas personales.
Domain-Driven Design, PostgreSQL, autenticación JWT con rotación de refresh tokens.

> **¿Querés entender el proyecto a fondo?** Empezá por
> [`docs/PROJECT_GUIDE.md`](./docs/PROJECT_GUIDE.md) — el documento maestro de arquitectura.

---

## Quick start

**Requisitos:** Docker Desktop, Node 20+

**1. Crear el archivo de entorno**

```bash
cp .env.example .env
```

Como mínimo, generá los dos secrets JWT (la app no arranca sin ellos):

```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
```

La app valida todas las variables al arrancar con Joi — si falta o está mal una `required`,
crashea de inmediato con un mensaje claro.

**2. Levantar la infraestructura local**

```bash
docker compose up -d
```

- PostgreSQL → `localhost:5433`  *(puerto 5433, no 5432)*
- Redis → `localhost:6379`
- pgAdmin → `http://localhost:5050` (credenciales en `docker-compose.yml`)

**3. Aplicar migraciones y correr la API**

```bash
npm install
npm run migration:run      # crea el schema (synchronize está OFF por defecto)
npm run start:dev
```

API → `http://localhost:3000`
Swagger → `http://localhost:3000/api/docs`

> El schema se gestiona con **migraciones**, no con `synchronize`. En dev podés activar
> `DB_SYNCHRONIZE=true` para autocrear tablas desde las entities, pero el camino por defecto
> (y obligatorio en prod) son las migraciones.

---

## Módulos

| Módulo | Resumen |
|---|---|
| **Auth** | Register, login, refresh con **rotación + detección de replay**, logout. Guard JWT global (deny-by-default) + `@Public()`. Rate-limit 5/min en `/auth/*`. Login timing-safe. |
| **Users** | CRUD. Ownership: solo tu propio perfil. |
| **Accounts** | Ciclo completo: crear, renombrar, archivar/desarchivar, borrar. Balance actualizado atómicamente dentro de una transacción DB en cada create/delete de transacción. |
| **Categories** | CRUD. `nature` (`income`/`expense`) inmutable tras crearse. Unicidad por DB + 409 mapeado. |
| **Budgets** | Un presupuesto por (user, categoría, mes, año). Los gastos requieren presupuesto activo y no pueden exceder el límite. |
| **Transactions** | Create + delete (sin update — corrección = borrar + recrear). Corre dentro de `IUnitOfWork` con locks pesimistas. |

---

## Arquitectura

Ver [`docs/PROJECT_GUIDE.md`](./docs/PROJECT_GUIDE.md) para el panorama completo:

- Estructura DDD de tres capas y reglas de dependencia entre módulos.
- Patrón Ports & Adapters (puertos como `abstract class` = tokens DI).
- Unit of Work + locks pesimistas (`FOR UPDATE`): cómo transactions, accounts y budgets
  comparten un `QueryRunner` por request.
- Modelo de autenticación (rotación de refresh tokens, detección de replay).
- Mapa de toda la documentación del repo.

Decisiones de diseño detalladas (ADRs co-localizados):
[`cache-decision.md`](./src/shared/domain/cache-decision.md) ·
[`uow-decision.md`](./src/shared/domain/uow-decision.md) ·
`src/modules/<m>/notes.md` por módulo.

---

## Tests

```bash
npm test                   # unitarios (dominio + casos de uso)
npm run test:integration   # integración con Postgres real (test/.env.test)
npm run test:cov           # cobertura
```

---

## Deploy

Ver el runbook completo en [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — empaquetado Docker
multi-stage, migraciones como release phase, variables de entorno, health checks y notas por
plataforma (PaaS / Kubernetes / VPS).

```bash
docker build -t personal-finance-api .
```
