// Puerto para verificar si existen gastos en un periodo.
// Puerto e implementación viven ambos en budgets (ver
// infrastructure/persistence/scoped-expense-checker.ts, servida por
// BudgetUnitOfWorkImpl.getScopedExpenseChecker()). No hay ningún otro módulo
// del dominio que dependa de este archivo ni que este archivo dependa de él.
// Consumidores: DeleteBudgetUseCase, UpdateBudgetLimitUseCase.
export abstract class IExpenseChecker {
  abstract hasExpensesInPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<boolean>;

  abstract sumExpenseAmountInPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<number>;
}
