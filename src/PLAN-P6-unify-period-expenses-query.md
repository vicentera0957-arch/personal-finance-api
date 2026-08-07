# PLAN P6 — Un solo dueño de la query "Σ gastos del período"

> Cierre de P6 (ver `PROBLEMS.md`). A diferencia de P3+P4, P5 y P7, no hay composición entre
> módulos ni ciclo de vida transaccional en juego — es una duplicación de una sentencia SQL entre
> dos puertos distintos. El plan es proporcional a eso: no hay tabla maestra de commits ni barrido
> de alcance, porque el alcance es dos archivos.

## 1. El problema

`ScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod`
(`transactions/infrastructure/persistence/unit-of-work.impl.ts`) y
`ScopedExpenseChecker.sumExpenseAmountInPeriod`
(`budgets/infrastructure/persistence/scoped-expense-checker.ts`) eran la misma sentencia carácter
por carácter: mismo `COALESCE(SUM(e.amount), 0)`, mismo `FROM v_period_expenses e`, mismos cuatro
filtros (`user_id`, `category_id`, `transaction_date >= start`, `transaction_date < end`), mismos
parámetros. Toda la inversión en `v_period_expenses` (una sola definición de "qué cuenta como
gasto") quedaba parcialmente desperdiciada un nivel más arriba, con dos lugares que la consultaban
de forma idéntica y ningún test que hubiera detectado una divergencia entre ellos.

## 2. Por qué no colapsar las clases ni los puertos

`ScopedTransactionRepository` y `ScopedExpenseChecker` corren sobre `EntityManager`s distintos
(`QueryRunner`s distintos, de dos UoW independientes — `TypeOrmUnitOfWorkImpl` y
`BudgetUnitOfWorkImpl`). No se puede compartir una instancia sin recrear el acoplamiento que P1/P2
cerraron. Tampoco hace falta: lo duplicado es la sentencia, no el objeto que la ejecuta. Los dos
puertos (`IScopedTransactionRepository.sumExpenseAmountByUserCategoryAndPeriod`,
`IExpenseChecker.sumExpenseAmountInPeriod`) se quedan con su nombre — documentan la pregunta de
cada consumidor bajo su propio lock, no la consulta en sí — y ambos delegan a una única función.

## 3. La solución

Extraer la sentencia a una función pura de infraestructura,
`sumPeriodExpenses(manager, userId, categoryId, month, year)`, en
`shared/infrastructure/persistence/period-expenses.query.ts` — mismo criterio que ya separaba
`monthPeriod()` en `shared/domain/month-period.ts` para los límites del período: una sola fuente,
consumida por ambos lados de un invariante que cruza módulos. Va en `infrastructure/` y no en
`domain/` porque toma un `EntityManager` (concepto de persistencia), tal como `monthPeriod` vive en
`domain/` porque no toca nada de infraestructura.

Ambos métodos quedan como una línea:

```ts
// transactions/infrastructure/persistence/unit-of-work.impl.ts
async sumExpenseAmountByUserCategoryAndPeriod(userId, categoryId, month, year) {
  return sumPeriodExpenses(this.manager, userId, categoryId, month, year);
}

// budgets/infrastructure/persistence/scoped-expense-checker.ts
async sumExpenseAmountInPeriod(userId, categoryId, month, year) {
  return sumPeriodExpenses(this.manager, userId, categoryId, month, year);
}
```

Sin cambio de comportamiento: mismo SQL generado, mismo `this.manager` (mismo `QueryRunner` de cada
caller), por lo tanto mismo modelo de lock — la serialización sigue viniendo del `FOR UPDATE` sobre
la fila de budget que cada caller toma antes de llamar a esta suma (ver la sección de concurrencia
en `CLAUDE.md`). `hasExpensesInPeriod` (COUNT, no SUM) no forma parte de esta duplicación — se queda
como estaba.

## 4. Tests

- Nuevo `period-expenses.query.spec.ts`: verifica el `FROM v_period_expenses`, los cuatro filtros,
  ausencia de lock (`setLock`) y el caso de período vacío (`total: undefined` → `0`).
- `scoped-expense-checker.spec.ts` no cambia — sigue mockeando al nivel de
  `manager.createQueryBuilder`, así que es agnóstico a que la sentencia ahora viva en una función
  compartida.
- Suite completa (`npm test`), `npm run build` (corre el type-test de P5,
  `uow-narrowing.type-test.ts`, sin relación con este cambio pero en el mismo `tsc`) y
  `test/integration/concurrency/concurrency.integration.spec.ts` (no tocado — es el regression net
  de los locks; sigue pasando sin modificaciones, como exige `CLAUDE.md`).

## 5. Criterio de aceptación

- Una sola definición de la sentencia SQL de "Σ gastos del período", en
  `shared/infrastructure/persistence/period-expenses.query.ts`.
- `ScopedTransactionRepository` y `ScopedExpenseChecker` no repiten `createQueryBuilder()...` — cada
  uno llama a `sumPeriodExpenses`.
- Cero cambio de comportamiento observable: mismos filtros, mismo lock model, misma suite pasando.
