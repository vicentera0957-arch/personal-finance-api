# Módulo `categories` — Referencia actual

## Dominio

### Value object `CategoryNature`

**Archivo:** `domain/value-objects/category-nature.vo.ts`

Lista cerrada normalizada a minúsculas: `income` | `expense`. No incluye `transfer` — las transferencias son una entidad separada.

Tiene método `reconstitute()` separado de `create()`. El mapper siempre usa `reconstitute()` al leer desde DB para no re-validar datos ya persistidos.

Por qué un VO y no un string: la regla R7 ("categoría de gasto solo clasifica gastos") necesita una representación centralizada. Con un string arbitrario, cualquier parte del sistema podría crear una categoría con `nature = "foo"`. Con el VO es imposible.

### Entidad `Category`

**Archivo:** `domain/entities/category.entity.ts`

Constructor privado. Dos factory methods (`create`, `reconstitute`).

Propiedades: `id`, `userId`, `name`, `nature` (`CategoryNature`), `isBudgetable`, `color?`, `icon?`, `createdAt`, `updatedAt`.

Métodos: `rename(name)`, `changeColor(color)`, `changeIcon(icon)`, `setBudgetable(value)`.

**No existe `changeNature()`** — la naturaleza es inmutable después de la creación. Cambiarla rompería la invariante R7 para todas las transacciones existentes de esa categoría.

### Excepciones de dominio

| Excepción | HTTP |
|-----------|------|
| `CategoryNotFoundException` | 404 |
| `DuplicateCategoryException` | 409 |
| `CategoryInUseException` | 409 |
| `CategoryBudgetableImmutableException` | 422 |

### Puerto `ICategoryRepository`

Clase abstracta. Métodos: `findById`, `findByUserId`, `save`, `delete`.

No tiene método `findByUserIdAndNameAndNature` — la validación de duplicados ocurre a nivel DB (ver abajo).

---

## Capa application

| Use case | Flujo |
|----------|-------|
| `CreateCategoryUseCase` | Crea VO `CategoryNature` → crea entidad → persiste → el repositorio atrapa `23505` → `DuplicateCategoryException` |
| `GetCategoryByIdUseCase` | Busca → valida ownership → lanza `CategoryNotFoundException` |
| `GetCategoriesByUserIdUseCase` | Retorna array (vacío es válido) |
| `UpdateCategoryUseCase` | Delega a `GetCategoryByIdUseCase` → aplica campos opcionales → persiste |
| `DeleteCategoryUseCase` | Verifica existencia y ownership → `repo.delete()` → repo atrapa FK violation `23503` → `CategoryInUseException` |

**Sobre `CreateCategoryUseCase`:** no hace un `findByUserId...` previo para detectar duplicados. El check es 100% a nivel DB — `CategoryRepositoryImpl.save()` atrapa `QueryFailedError` con `code === '23505'` y lanza `DuplicateCategoryException`. Esto cierra la race condition de "check-then-insert" sin necesidad de un query previo.

**Sobre `UpdateCategoryUseCase`:** un solo use case para todos los campos editables (`name`, `color`, `icon`, `isBudgetable`). Todos opcionales. Sin efectos secundarios complejos — solo "editar metadatos". A diferencia de `accounts`, no hay separación en use cases granulares porque no hay operaciones con consecuencias de estado (como archivar).

**Sobre `isBudgetable`:** puede ser cambiado por `UpdateCategoryUseCase`, pero hay una restricción: si la categoría ya tiene transacciones o budgets asociados, cambiar `isBudgetable` puede invalidarlos. La entidad lanza `CategoryBudgetableImmutableException` en ese caso (verificar regla exacta en la entidad si necesitás el detalle).

---

## Capa infrastructure

### `CategoryOrmEntity`

**Archivo:** `infrastructure/persistence/category.orm.entity.ts`

| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | `uuid` | PK, generado con `randomUUID()` |
| `userId` | `varchar` | Referencia lógica |
| `name` | `varchar` | Máximo 80 caracteres |
| `nature` | `varchar` | `income` o `expense` |
| `isBudgetable` | `boolean` | Default `true` |
| `color` | `varchar` | Nullable |
| `icon` | `varchar` | Nullable |
| `createdAt` | `timestamp` | `@Column` simple |
| `updatedAt` | `timestamp` | `@Column` simple |

`@Unique(['userId', 'name', 'nature'])` — constraint a nivel DB.

### `CategoryRepositoryImpl`

**Archivo:** `infrastructure/persistence/category.repo.implement.ts`

`save()` atrapa `QueryFailedError`:
- `code === '23505'` → `DuplicateCategoryException` (409)
- `code === '23503'` → `CategoryInUseException` (409) (en `delete()`)

### `CategoryMapper`

`toDomain(orm)` — usa `CategoryNature.reconstitute()` (no `create()`). `Category.reconstitute()` para preservar timestamps.

### Rutas

| Método | Ruta | Use case | HTTP |
|--------|------|----------|------|
| POST | `/categories` | `CreateCategoryUseCase` | 201 |
| GET | `/categories` | `GetCategoriesByUserIdUseCase` | 200 |
| GET | `/categories/:id` | `GetCategoryByIdUseCase` | 200 |
| PATCH | `/categories/:id` | `UpdateCategoryUseCase` | 200 |
| DELETE | `/categories/:id` | `DeleteCategoryUseCase` | 204 |

---

## Wiring — `CategoriesModule`

Exports: `GetCategoryByIdUseCase` — consumido por `budgets` (valida la categoría al crear un budget) y por `transactions` (valida R7 + ownership cross-module).

---

## Defense in depth para el delete

La regla "no eliminar categoría en uso" tiene dos capas:

1. **Repositorio:** `delete()` atrapa `23503` → `CategoryInUseException`
2. **Base de datos:** FK con `onDelete: 'RESTRICT'` en las tablas `transactions` y `budgets`

Si la capa de aplicación fallara por cualquier razón, Postgres rechaza el DELETE de todos modos. Es el patrón defense-in-depth aplicado a integridad referencial.

---

## Sub-categorías (extensión futura)

Para "Comida → Restaurantes, Supermercado", tres patrones clásicos:
- **Adjacency list** (`parentId` self-FK) — fácil INSERT, costoso leer jerarquía completa
- **Materialized path** (`path = '1/4/17'`) — fácil lectura, caro mover ramas
- **Nested sets** (`lft`, `rgt`) — lectura O(1), INSERT costoso

Para una app de finanzas personales, adjacency list + `WITH RECURSIVE` es suficiente.

---

## Recursos

- 📄 "Trees and Hierarchies in SQL" — Joe Celko
- 🎥 Ben Awad — "Recursive CTEs in PostgreSQL"
- 📄 postgresql.org/docs → "WITH Queries (Common Table Expressions)"
