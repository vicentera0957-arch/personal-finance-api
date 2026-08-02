// Puerto para verificar si existen gastos en un periodo.
// Puerto e implementación viven ambos en budgets (ver
// infrastructure/persistence/scoped-expense-checker.ts, servida por
// BudgetUnitOfWorkImpl.getScopedExpenseChecker()). No hay dependencia
// circular con transactions que resolver aquí: transactions ni siquiera
// importa este puerto. Consumidores: DeleteBudgetUseCase,
// UpdateBudgetLimitUseCase.
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
