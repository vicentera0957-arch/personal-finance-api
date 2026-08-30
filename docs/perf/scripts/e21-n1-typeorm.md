# E21 · El N+1 de TypeORM — runbook

No es SQL: se mide desde la app, contando cuántas sentencias emite el ORM.

> ⚠️ **Aviso honesto antes de empezar.** El enunciado del plan asume que este
> repositorio tiene un N+1. **No lo tiene.** Verificarlo es la primera mitad del
> ejercicio; la segunda es fabricar uno a propósito para ver el contraste. Un
> ejercicio que confirma una ausencia vale igual que uno que encuentra un
> problema — lo que no vale es asumir cualquiera de las dos cosas.
>
> Las dos razones por las que no lo tiene están en el código:
>
> - [transaction.repo.implement.ts:56-61](../../../src/modules/transactions/infrastructure/persistence/transaction.repo.implement.ts#L56-L61)
>   — `find()` sin `relations`. No pide las asociaciones, así que no hay nada que
>   cargar de a una.
> - [transaction.orm.entity.ts:44-72](../../../src/modules/transactions/infrastructure/persistence/transaction.orm.entity.ts#L44-L72)
>   — las relaciones `@ManyToOne` están tipadas `user?: UserOrmEntity`, **no**
>   `Promise<UserOrmEntity>`. En TypeORM 0.3 el lazy loading se activa por el
>   tipo `Promise<T>`. Sin eso no hay carga diferida, y sin carga diferida no hay
>   N+1 posible.

---

## Fase 1 — Encender el log

Ya existe la variable, no hay que tocar código:
[app.module.ts:117](../../../src/app.module.ts#L117) lee `DB_LOGGING`.

En `.env`:

```ini
DB_LOGGING=true
```

Levantá la app:

```powershell
npm run start:dev
```

## Fase 2 — Medir el estado actual

Pedí un access token y llamá al listado. Anotá **cuántas sentencias `SELECT`
aparecen en la consola de Nest** por cada request.

```powershell
$body = @{ email = 'seed-load-user-1@finanzas.dev'; password = '<la del seed>' } | ConvertTo-Json
$r = Invoke-RestMethod -Uri http://localhost:3000/auth/login -Method Post -Body $body -ContentType 'application/json'
$h = @{ Authorization = "Bearer $($r.accessToken)" }
Invoke-RestMethod -Uri 'http://localhost:3000/transactions?limit=20' -Headers $h | Out-Null
```

**Esperado: 1.** Limpiá la consola antes de cada llamada para no contar de más.

| Variante | Sentencias | Tiempo total |
| --- | --- | --- |
| actual (`find` sin `relations`) |  |  |

## Fase 3 — Fabricar el contraste

Tres variantes. En cada una: editá `findByUserId`, guardá (el watch recompila),
llamá al endpoint, contá sentencias, y **volvé atrás antes de la siguiente**.
Ninguna de estas se commitea.

### Variante A — `relations` (join en una sola query)

```ts
const orms = await this.ormRepository.find({
  where,
  relations: ['category', 'account'],
  skip: options?.offset,
  take: options?.limit,
  order: { transactionDate: 'DESC' },
});
```

Mirá la sentencia emitida: `LEFT JOIN`. Sigue siendo **una**.

### Variante B — `relationLoadStrategy: 'query'`

```ts
const orms = await this.ormRepository.find({
  where,
  relations: ['category', 'account'],
  relationLoadStrategy: 'query',
  skip: options?.offset,
  take: options?.limit,
  order: { transactionDate: 'DESC' },
});
```

Ahora son varias — pero **una por relación**, no una por fila. Es el patrón que
usan los ORMs para evitar la explosión de filas de un join múltiple.

### Variante C — el N+1 de verdad

```ts
const orms = await this.ormRepository.find({
  where,
  skip: options?.offset,
  take: options?.limit,
  order: { transactionDate: 'DESC' },
});

// N+1 DELIBERADO — no commitear
for (const orm of orms) {
  orm.category = await this.ormRepository.manager.findOne(CategoryOrmEntity, {
    where: { id: orm.categoryId },
  });
}
```

Con `limit=20` vas a ver 21 sentencias. Probá después con `limit=100`.

| Variante | Sentencias (limit=20) | Sentencias (limit=100) | Tiempo total |
| --- | --- | --- | --- |
| actual |  |  |  |
| A · `relations` |  |  |  |
| B · `relationLoadStrategy: 'query'` |  |  |  |
| C · N+1 deliberado |  |  |  |

## Fase 4 — El plan de una query individual

Tomá **una sola** de las N sentencias de la variante C y pegala en `pg` con
`EXPLAIN (ANALYZE, BUFFERS)` adelante.

**Ese es el punto entero del ejercicio.** El plan de esa query es impecable:
Index Scan por primary key, un puñado de buffers, microsegundos. No hay nada que
optimizar en ella. Y sin embargo el agregado es catastrófico, porque el costo
que importa no está en el plan sino en el **round-trip** repetido 100 veces.

## Fase 5 — Volver atrás

```powershell
git diff --stat
git checkout -- src/modules/transactions/infrastructure/persistence/transaction.repo.implement.ts
```

Y en `.env`, `DB_LOGGING=false`.

---

## Las preguntas

1. Un profiler de base de datos (`pg_stat_statements`, un dashboard de RDS)
   muestra queries lentas. ¿Por qué un N+1 es **invisible** para esa herramienta?
2. La variante A resuelve el N+1 con un join. ¿En qué caso el join es peor que
   la variante B, y por qué? Pista: pensá qué pasa con dos relaciones
   `OneToMany` en el mismo `find`.
3. Tu repositorio no tiene el problema, pero tampoco tiene una defensa. ¿Qué
   cambio en el código lo introduciría sin que nadie lo note en code review?

## Entregable

`performance.md` §5 con la tabla de conteos antes/después y una conclusión de dos
líneas: qué encontraste (nada) y por qué eso es un resultado, no una falta de
resultado.
