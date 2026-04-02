# Implementación de la feature `categories`

---

## Paso 0 — Definir el alcance

Antes de escribir una sola línea de código, documentar qué hace y qué no hace esta feature en V1.

### Casos de uso — V1

- `CreateCategory` — crear una categoría con nombre, naturaleza (income/expense), si es presupuestable, y opcionalmente color e ícono
- `GetCategoryById` — recuperar una categoría por su id
- `GetCategoriesByUserId` — listar todas las categorías de un usuario
- `UpdateCategory` — actualizar nombre, color, ícono y/o si es presupuestable (NO se puede cambiar la naturaleza)
- `DeleteCategory` — eliminar una categoría permanentemente

### Casos de uso — fuera de scope en V1

- Categorías globales o plantillas compartidas entre usuarios (R6: categoría pertenece a un usuario)
- Categorías jerárquicas (subcategorías)
- Merge de categorías
- Seed/default categories al crear un usuario
- Validación de si la categoría tiene transacciones asociadas antes de eliminar (se confía en la FK de la DB por ahora)

### Pendientes técnicos

- **FK violation en `delete` (error `23503`):** Cuando exista el módulo `transactions` con FK a `categories.id`, un `DELETE` de categoría con transacciones asociadas lanzará un error crudo de PostgreSQL → `500`. Hay que capturar `error.code === '23503'` en `CategoryRepositoryImpl.delete()` y convertirlo en una excepción de dominio (`CategoryHasTransactionsException`) mapeada a `409` en el controlador.
- **`userId` en el body del request:** `CreateCategoryDto` recibe `userId` del cliente. Cuando se implemente el módulo `auth` con JWT, el `userId` debe extraerse del token (`@CurrentUser()`) y no del body — de lo contrario cualquier cliente puede crear categorías en nombre de otro usuario.

### Resultado esperado

Un slice vertical completo: desde la base de datos hasta la respuesta HTTP, pasando por use cases y el repositorio concreto. La categoría exporta `GetCategoryByIdUseCase` para que el módulo `transactions` pueda validar que la categoría existe y que su naturaleza coincide con la de la transacción (R7).

---

## Paso 1 — Capa domain

### 1.1 Value object `CategoryNature`

**Archivo:** `domain/value-objects/category-nature.vo.ts`

Clase inmutable que encapsula la naturaleza de una categoría: `income` o `expense`. Sigue el mismo patrón que `AccountType` — lista cerrada de valores válidos, normalización a minúsculas.
IMPORTANTE: Se añade un metodo de reconstitucion dentro del vo, asi logrammos felxibilizar la persistencia de datos durante las primeras instancias de la API y cubrir la data persistidad a posibles cambios de negocio.

> **Decisión: ¿por qué un VO y no un simple string?**
> La regla de negocio R7 dice: "una categoría de gasto solo clasifica gastos; una categoría de ingreso solo clasifica ingresos". Esto significa que `nature` no es un string arbitrario — es un INVARIANTE del dominio que necesita validación centralizada. Si fuera un string, cualquier parte del sistema podría crear una categoría con `nature = "foo"`. Con el VO, es imposible tener una naturaleza inválida.
>
> Además, este VO será usado por el módulo `transactions` para validar compatibilidad (R7): la naturaleza de la transacción debe coincidir con la naturaleza de su categoría.

> **Decisión: ¿por qué no incluir `transfer` como naturaleza?**
> Según el esquema de BD, las transferencias son una tabla separada (`transfers`), no una transacción con categoría. Una categoría clasifica ingresos o gastos, nunca transferencias. Las transferencias son un concepto diferente que no pasa por categorías.

### 1.2 Entidad `Category`

**Archivo:** `domain/entities/category.entity.ts`

Clase pura sin decoradores. Constructor privado con dos factory methods:

- `Category.create(props)` — para categorías nuevas; genera `createdAt` y `updatedAt`
- `Category.reconstitute(props)` — para reconstruir desde persistencia; acepta todas las fechas

Propiedades: `id`, `userId`, `name`, `nature` (tipo `CategoryNature`), `isBudgetable`, `color` (opcional), `icon` (opcional), `createdAt`, `updatedAt`.

Métodos de dominio:

- `rename(name)` — valida que no esté vacío
- `changeColor(color)` — actualiza el color
- `changeIcon(icon)` — actualiza el ícono
- `setBudgetable(value)` — marca o desmarca como presupuestable

> **Decisión: `updatedAt` no está en el esquema original de BD**
> El diagrama de la BD solo tiene `created_at` para categorías, no `updated_at`. Sin embargo, decidí agregarlo porque:
>
> 1. Necesitamos soportar actualizaciones (renombrar, cambiar color/ícono/presupuestable)
> 2. Tener registro de cuándo fue la última modificación es una buena práctica
> 3. Mantiene consistencia con las otras entidades del sistema (users, accounts)
> 4. El costo es mínimo — una columna timestamp extra

> **Decisión: la naturaleza NO se puede cambiar después de creada**
> No hay método `changeNature()`. Razón: si una categoría "Supermercado" (expense) tiene 50 transacciones de gasto asociadas, cambiarla a `income` rompería la invariante R7 para todas esas transacciones existentes. Es más seguro crear una categoría nueva y migrar. Esta restricción se refuerza en la entidad al no exponer un método para modificar `nature`.

**AGREGAR: Columna timestamp de uppdated at en el diagrama de la db**

### 1.3 Excepciones de dominio

**Archivo:** `domain/exceptions/category.exceptions.ts`

Clases que extienden la base `CategoryException extends Error`, no `HttpException`. El mapeo a HTTP ocurre en el controlador.

- `CategoryNotFoundException` — categoría no encontrada por id
- `DuplicateCategoryException` — ya existe una categoría con el mismo nombre y naturaleza para ese usuario

> **Decisión: ¿por qué `DuplicateCategoryException`?**
> No tiene mucho sentido que un usuario tenga dos categorías "Supermercado" de tipo expense. Aunque no es una regla explícita en el documento de reglas de negocio, es una restricción de sentido común que mejora la UX y evita confusión. La validación se hace en el use case, no en la entidad, porque requiere consultar la BD.

### 1.4 Interface `ICategoryRepository`

**Archivo:** `domain/repository/category.repository.ts`

Puerto de salida definido como clase abstracta (necesario para que NestJS lo use como token de DI). Métodos:

- `findById(id: string): Promise<Category | null>`
- `findByUserId(userId: string): Promise<Category[]>`
- `save(category: Category): Promise<Category>`
- `delete(id: string): Promise<void>`

> **Nota:** La validación de duplicados no se hace con un método `findByUserIdAndNameAndNature` previo. En cambio, `save()` delega al constraint `@Unique(['userId', 'name', 'nature'])` de la DB y el repositorio captura el error `23505` de PostgreSQL para lanzar `DuplicateCategoryException`.

---

## Paso 2 — Capa application

### 2.1 `CreateCategoryUseCase`

**Archivo:** `application/use-cases/create-category.use-case.ts`

1. Crea el VO `CategoryNature` con la naturaleza recibida — lanza error de dominio si no es válida
2. Verifica que no exista una categoría con el mismo nombre y naturaleza para el usuario
3. Lanza `DuplicateCategoryException` si ya existe
4. Crea la entidad con `Category.create()`
5. Persiste via `ICategoryRepository.save()`
6. Retorna la categoría creada

### 2.2 `GetCategoryByIdUseCase`

**Archivo:** `application/use-cases/get-category-by-id.use-case.ts`

1. Busca via `ICategoryRepository.findById`
2. Lanza `CategoryNotFoundException` si no existe
3. Retorna la categoría

### 2.3 `GetCategoriesByUserIdUseCase`

**Archivo:** `application/use-cases/get-categories-by-user-id.use-case.ts`

1. Busca via `ICategoryRepository.findByUserId`
2. Retorna el array (puede ser vacío — no es un error)

### 2.4 `UpdateCategoryUseCase`

**Archivo:** `application/use-cases/update-category.use-case.ts`

1. Recupera la categoría via `GetCategoryByIdUseCase`
2. Si se recibe `name`, llama a `category.rename(name)`
3. Si se recibe `color`, llama a `category.changeColor(color)`
4. Si se recibe `icon`, llama a `category.changeIcon(icon)`
5. Si se recibe `isBudgetable`, llama a `category.setBudgetable(value)`
6. Persiste via `ICategoryRepository.save()`
7. Retorna la categoría actualizada

> **Decisión: un solo use case para múltiples campos actualizables**
> A diferencia de accounts (que tiene use cases separados como `RenameAccountUseCase` y `ArchiveAccountUseCase`), aquí agrupé todo en un solo `UpdateCategoryUseCase`. Razón: las operaciones de actualización de una categoría son todas "editar metadatos" sin efectos secundarios complejos. No hay nada equivalente a "archivar" que cambie el comportamiento de la entidad. Un solo PATCH con campos opcionales es más ergonómico para el cliente.

### 2.5 `DeleteCategoryUseCase`

**Archivo:** `application/use-cases/delete-category.use-case.ts`

1. Verifica que la categoría existe via `GetCategoryByIdUseCase`
2. Elimina via `ICategoryRepository.delete()`

> **Decisión: no validar si hay transacciones asociadas**
> En V1, la FK en la tabla `transactions` impedirá eliminar una categoría que tenga transacciones. PostgreSQL lanzará un error de integridad referencial que se traducirá a un 409 o 500. En una V2 se podría hacer una validación explícita con un mensaje más amigable.

---

## Paso 3 — Capa infrastructure

### 3.1 `CategoryOrmEntity`

**Archivo:** `infrastructure/persistence/category.orm.entity.ts`

Entidad TypeORM completamente separada de la entidad de dominio. Columnas:

| Columna        | Tipo        | Notas                                           |
| -------------- | ----------- | ----------------------------------------------- |
| `id`           | `uuid`      | PK, generado fuera de TypeORM (en el use case)  |
| `userId`       | `varchar`   | Referencia lógica al usuario                    |
| `name`         | `varchar`   | Máximo 80 caracteres                            |
| `nature`       | `varchar`   | `income` o `expense`                            |
| `isBudgetable` | `boolean`   | Default `true`                                  |
| `color`        | `varchar`   | Nullable — el frontend puede tener un default   |
| `icon`         | `varchar`   | Nullable — el frontend puede tener un default   |
| `createdAt`    | `timestamp` |                                                 |
| `updatedAt`    | `timestamp` | Agregado (no está en el esquema original de BD) |

### 3.2 `CategoryMapper`

**Archivo:** `infrastructure/persistence/category.mapper.ts`

Convierte entre las dos representaciones. Es el único lugar que conoce ambas capas:

- `toDomain(orm: CategoryOrmEntity): Category` — usa `CategoryNature.reconstitute(nature)` para el VO (no re-valida datos ya persistidos); usa `Category.reconstitute()`
- `toOrm(domain: Category): CategoryOrmEntity` — usa `getNature()` para extraer el string del VO

### 3.3 `CategoryRepositoryImpl`

**Archivo:** `infrastructure/persistence/category.repo.implement.ts`

Implementa `ICategoryRepository` usando el repositorio de TypeORM. Usa `CategoryMapper` en cada operación. Extiende `ICategoryRepository` (clase abstracta) e inyecta `Repository<CategoryOrmEntity>`.

### 3.4 DTOs

**Archivos:** `infrastructure/http/dto/`

- `CreateCategoryDto` — `userId`, `name`, `nature`, `isBudgetable`, `color?`, `icon?` con validaciones de `class-validator`
- `UpdateCategoryDto` — `name?`, `color?`, `icon?`, `isBudgetable?` — todos opcionales
- `CategoryResponseDto` — `id`, `userId`, `name`, `nature`, `isBudgetable`, `color`, `icon`, `createdAt`, `updatedAt`

### 3.5 `CategoriesController`

**Archivo:** `infrastructure/http/categories-controller/categories.controller.ts`

| Método | Ruta                       | Use case                       | HTTP success |
| ------ | -------------------------- | ------------------------------ | ------------ |
| POST   | `/categories`              | `CreateCategoryUseCase`        | 201          |
| GET    | `/categories/:id`          | `GetCategoryByIdUseCase`       | 200          |
| GET    | `/categories/user/:userId` | `GetCategoriesByUserIdUseCase` | 200          |
| PATCH  | `/categories/:id`          | `UpdateCategoryUseCase`        | 200          |
| DELETE | `/categories/:id`          | `DeleteCategoryUseCase`        | 204          |

Cada handler atrapa las excepciones de dominio y las traduce a su equivalente HTTP:

| Excepción de dominio         | HTTP |
| ---------------------------- | ---- |
| `CategoryNotFoundException`  | 404  |
| `DuplicateCategoryException` | 409  |

---

## Paso 4 — Wiring

### 4.1 `CategoriesModule`

**Archivo:** `categories.module.ts`

```typescript
@Module({
  imports: [TypeOrmModule.forFeature([CategoryOrmEntity])],
  controllers: [CategoriesController],
  providers: [
    // Mapper
    CategoryMapper,

    // Use Cases
    CreateCategoryUseCase,
    GetCategoryByIdUseCase,
    GetCategoriesByUserIdUseCase,
    UpdateCategoryUseCase,
    DeleteCategoryUseCase,

    // Vincula la interfaz con su implementación
    {
      provide: ICategoryRepository,
      useClass: CategoryRepositoryImpl,
    },
  ],
  exports: [GetCategoryByIdUseCase], // exportado para el módulo transactions
})
export class CategoriesModule {}
```

### 4.2 Registrar en `AppModule`

Importar `CategoriesModule` en `app.module.ts`.

---

## Paso 5 — Verificación

- [ ] `POST /categories` crea una categoría y retorna el `CategoryResponseDto`
- [ ] `POST /categories` con naturaleza inválida retorna `400 Bad Request`
- [ ] `POST /categories` con nombre duplicado + misma naturaleza retorna `409 Conflict`
- [ ] `GET /categories/:id` retorna la categoría correcta
- [ ] `GET /categories/:id` con id inexistente retorna `404 Not Found`
- [ ] `GET /categories/user/:userId` retorna el array de categorías del usuario
- [ ] `GET /categories/user/:userId` sin categorías retorna array vacío `[]`
- [ ] `PATCH /categories/:id` actualiza los campos enviados y retorna la categoría
- [ ] `PATCH /categories/:id` no permite cambiar `nature`
- [ ] `DELETE /categories/:id` elimina la categoría y retorna `204 No Content`
- [ ] `DELETE /categories/:id` con id inexistente retorna `404 Not Found`
- [ ] El módulo `transactions` puede importar `GetCategoryByIdUseCase` sin errores
