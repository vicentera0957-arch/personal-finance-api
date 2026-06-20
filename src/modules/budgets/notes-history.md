# Módulo `budgets` — Histórico y post-mortems

> Races/bugs cerrados con análisis propio de budgets. El estado **actual** vive en [notes.md](./notes.md).

---

## Race "check-then-insert" en CreateBudget — CERRADA

**Estado previo:** `CreateBudgetUseCase` hacía check + insert sin garantía de atomicidad — dos requests simultáneos podían pasar ambos el check y crear duplicados del mismo `(userId, categoryId, month, year)`.

**Estado actual:** `@Unique(['userId', 'categoryId', 'month', 'year'])` en `BudgetOrmEntity` + migración `1745366400000` + `catch 23505` en `BudgetRepositoryImpl.save()` → retorna 409 (`BudgetAlreadyExistsException`) en vez de 500.

---

## Bug A — Write skew en UpdateBudgetLimit vs CreateTransaction — RESUELTO

Anclado a `CreateTransaction`. El análisis completo (escenario, fix, por qué funciona) vive en [transactions/notes-history.md](../transactions/notes-history.md), porque la corrección principal está en `create-transaction.use-case.ts` y `unit-of-work.impl.ts`.

**Resumen del lado de budgets:** ambos flujos (`UpdateBudgetLimit` y `CreateTransaction`) ahora compiten por el mismo lock de fila del budget. `ScopedBudgetRepository.findById` y `findByUserIdAndCategoryIdAndPeriod` toman `FOR UPDATE`; la segunda lectura del budget en `CreateTransaction` se movió dentro del UoW. Postgres serializa: el segundo en llegar espera el COMMIT del primero y lee el límite vigente.

---

## Race 1 — DELETE /budgets/:id vs POST /transactions (cross-cutting)

Documentado centralmente en [docs/history/race-conditions-fix-2026-05.md](../../../docs/history/race-conditions-fix-2026-05.md).

En breve: `DeleteBudgetUseCase` corre dentro de `IBudgetUnitOfWork`; `ScopedBudgetRepository.findById` toma `FOR UPDATE` y `getScopedExpenseChecker().hasExpensesInPeriod` corre bajo el mismo `QueryRunner`. El budget row actúa de mutex: quien gana el lock completa su sección crítica de forma atómica, y el perdedor o ve el budget borrado (404) o ve gastos en el período (409).
