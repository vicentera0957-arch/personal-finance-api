// Puerto para verificar si existen gastos en un periodo.
// Definido en budgets para evitar dependencia circular con transactions.
// La implementación concreta vive en transactions y se inyecta en budgets.
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
