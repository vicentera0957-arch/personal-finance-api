export abstract class BudgetException extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidAmountLimitException extends BudgetException {
  constructor(message: string) {
    super(`Monto limite invalido: ${message}`);
  }
}

export class InvalidBudgetMonthException extends BudgetException {
  constructor(month: number) {
    super(`Mes de presupuesto invalido: ${month}. Debe estar entre 1 y 12`);
  }
}

export class InvalidBudgetYearException extends BudgetException {
  constructor(year: number) {
    super(`Anio de presupuesto invalido: ${year}. Debe ser un entero positivo`);
  }
}
