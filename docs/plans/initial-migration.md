# Plan — Migración inicial del schema

## Contexto

Hoy el proyecto solo tiene una migración (`1745366400000-AddBudgetUniqueConstraint.ts`) que ejecuta un `ALTER TABLE` sobre tablas que en producción **no existirían**. En desarrollo todo funciona porque `DB_SYNCHRONIZE=true` hace que TypeORM cree las tablas leyendo las ORM entities cada vez que arranca la app. Esa magia **debe quedarse fuera de producción**:

- `synchronize` puede borrar columnas si el ORM y la DB divergen.
- No hay control de versiones del schema (no se sabe en qué estado está la DB de cada entorno).
- No hay rollback posible.

**Objetivo:** generar una migración inicial reproducible y dejar el deploy listo para correr migrations en CI/CD con `synchronize: false`.

---

## Estado deseado

1. Una migración `XXXXXXXXXXXXX-InitialSchema.ts` que crea **todas** las tablas, índices, FKs y constraints actuales del proyecto.
2. La migración existente `AddBudgetUniqueConstraint.ts` queda como segunda en el orden cronológico (el `ALTER TABLE` aplicado encima del schema inicial).
3. `npm run migration:run` levanta una DB vacía a su estado actual sin que `synchronize` esté activo.
4. El pipeline de CI corre `migration:run` antes de iniciar la app.
5. Tests de integración usan migraciones, no `synchronize`.

---

## Plan paso a paso

### Paso 1 — Verificar `data-source.ts`

Abrir `src/data-source.ts` y confirmar que:

- Lee variables de entorno consistentes con `app.module.ts`.
- Apunta al directorio `src/database/migrations/` (o el que el proyecto use ya).
- Tiene `migrations: ['src/database/migrations/*.ts']` y `synchronize: false`.

Si falta algo, ajustarlo. Este archivo es el que la CLI de TypeORM usa para conocer entidades y migraciones.

### Paso 2 — Preparar una DB limpia

```bash
# Apagar contenedores y borrar volumen para asegurar DB virgen
docker compose down -v
docker compose up -d
```

> ⚠️ Esto borra todos los datos locales. Es intencional: la migración inicial debe generarse contra un schema vacío, no contra el estado mutado por `synchronize`.

### Paso 3 — Crear la DB vacía pero NO sincronizar

Temporalmente forzar que el primer arranque NO use `synchronize`:

```bash
# En .env (temporal)
DB_SYNCHRONIZE=false
```

Sin `synchronize`, la app fallará en el primer request porque las tablas no existen — es correcto. Solo necesitamos que la conexión TypeORM se establezca para que la CLI genere la migración.

### Paso 4 — Generar la migración

```bash
npm run migration:generate -- src/database/migrations/InitialSchema
```

TypeORM compara las ORM entities contra la DB vacía y genera el SQL completo: `CREATE TABLE`, `CREATE INDEX`, FKs, uniques.

### Paso 5 — Auditar el SQL generado

**No commitear sin leer.** Abrir el archivo generado y verificar:

- ✅ Todas las tablas: `users`, `accounts`, `categories`, `budgets`, `transactions`, `migrations` (esta última la crea TypeORM).
- ✅ Índices declarados con `@Index()` aparecen.
- ✅ FKs con `onDelete` correcto (CASCADE en `user_id`, RESTRICT donde aplique).
- ✅ Tipos: `varchar(N)`, `int`, `timestamp`, `uuid`. Si aparece algún `Object` o tipo extraño es un bug en una ORM entity.
- ✅ Unique constraints: `uq_users_email`, `(userId, name, nature)` en categories, etc.

### Paso 6 — Verificar que la migración se aplica

```bash
# Restaurar synchronize false y resetear DB
docker compose down -v
docker compose up -d

# Correr migraciones en orden
npm run migration:run
```

Debe ejecutar `InitialSchema` primero y `AddBudgetUniqueConstraint` después. Comprobar:

```bash
npm run migration:show
# Debe mostrar ambas con [X] (aplicadas)
```

### Paso 7 — Smoke test con la app

```bash
npm run start:dev
```

La app debe arrancar y los endpoints funcionar. Si falla algo, hay drift entre las ORM entities y lo que generó la migración → revisar el archivo generado.

### Paso 8 — Endurecer config en código

En `src/app.module.ts`, dejar el flag de `synchronize` así:

```ts
synchronize: config.get<string>('NODE_ENV') === 'development'
  && config.get<boolean>('DB_SYNCHRONIZE', false),
```

> Ya está parecido. Solo confirmar que un deploy con `NODE_ENV=production` ignora `DB_SYNCHRONIZE` aunque alguien lo ponga `true` por error.

### Paso 9 — Integrar en CI/CD

En el pipeline de despliegue:

```yaml
- name: Run migrations
  run: npm run migration:run
  env:
    DB_HOST: ${{ secrets.DB_HOST }}
    # ...resto de vars

- name: Start app
  run: node dist/main
```

La migración debe correr **antes** de levantar la app, no en paralelo. Si falla, el deploy aborta.

### Paso 10 — Tests de integración con migrations

`test/.env.test` ya tiene credenciales separadas. Asegurar que los specs de integración:

1. Apuntan a una DB de test diferente (`personal_finance_db_test`).
2. Antes de cada suite: `migration:run`.
3. Después de cada suite: truncate de tablas (no drop).

> No usar `synchronize: true` en tests. Cuando el día de mañana cambies una entidad, `synchronize` te oculta que la migración no está actualizada — y prod se rompe.

---

## Criterios de aceptación

- [ ] Existe `src/database/migrations/XXXXXXXXXXXXX-InitialSchema.ts` con todas las tablas.
- [ ] `docker compose down -v && docker compose up -d && npm run migration:run` deja la DB en estado utilizable por la app.
- [ ] `npm run migration:show` lista las dos migraciones aplicadas.
- [ ] `synchronize` está OFF en prod aunque el `.env` diga lo contrario.
- [ ] Un job de CI corre `migration:run` antes de iniciar la app.
- [ ] Tests de integración usan migraciones, no synchronize.

---

## Estrategia de rollback

Cada migración tiene método `down()` que TypeORM autogenera (DROP TABLE, etc.). Para revertir:

```bash
npm run migration:revert
```

Revierte la última migración aplicada. Útil en caso de error de un deploy reciente, **pero**:

> ⚠️ `migration:revert` borra datos. Solo úsalo en dev o en un rollback de emergencia donde la pérdida de datos sea aceptable. En prod, prefiere un fix-forward (nueva migración que arregle el estado anterior).

---

## Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| El SQL generado tiene `Object` en alguna columna nullable | Auditoría manual del archivo generado (paso 5). Ya hay precedente: `category.color`, `transaction.description` requirieron `type: 'varchar'` explícito. |
| FKs con orden incorrecto causan fallo al crear tablas | TypeORM ordena por dependencias. Si falla, mover manualmente bloques `CREATE TABLE` en el archivo generado. |
| `AddBudgetUniqueConstraint` choca con el `UNIQUE` ya generado en `InitialSchema` | Auditoría manual: si la migración inicial ya creó la unique, eliminar el `ALTER TABLE` redundante de la migración antigua o convertirla en no-op. |
| Migración se corre dos veces en CI | TypeORM mantiene la tabla `migrations` como ledger. Una migración aplicada no se reaplicará. |

---

## Recursos

- [TypeORM Migrations — Generating](https://typeorm.io/migrations#generating-migrations)
- [Strong Migrations README](https://github.com/ankane/strong_migrations) — patrones de migrations seguras (Ruby pero conceptos universales)
- [PostgreSQL — ALTER TABLE locking notes](https://www.postgresql.org/docs/current/sql-altertable.html)

---

## Tiempo estimado

- Generación + auditoría: 2 h
- Integración en CI: 1 h
- Tests integration adaptados: 1-2 h

**Total: medio día de trabajo concentrado.**
