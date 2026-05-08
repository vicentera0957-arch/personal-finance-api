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

export class BudgetNotFoundException extends BudgetException {
  constructor(id: string) {
    super(`Presupuesto no encontrado: ${id}`);
  }
}

export class BudgetAlreadyExistsException extends BudgetException {
  constructor(userId: string, categoryId: string, month: number, year: number) {
    super(
      `Ya existe un presupuesto para user=${userId}, category=${categoryId}, periodo=${month}/${year}`,
    );
  }
}

export class BudgetCategoryMustBeExpenseException extends BudgetException {
  constructor(categoryId: string, nature: string) {
    super(
      `La categoria ${categoryId} tiene naturaleza ${nature}. Solo se permite presupuesto para categorias expense`,
    );
  }
}

export class BudgetRequiredForExpenseTransactionException extends BudgetException {
  constructor(categoryId: string, month: number, year: number) {
    super(
      `No existe presupuesto mensual para la categoria ${categoryId} en el periodo ${month}/${year}`,
    );
  }
}

export class BudgetHasTransactionsInPeriodException extends BudgetException {
  constructor(id: string, month: number, year: number) {
    super(
      `No se puede eliminar el presupuesto ${id} porque existen transacciones de gasto en el periodo ${month}/${year}`,
    );
  }
}

export class BudgetLimitExceededException extends BudgetException {
  constructor(
    categoryId: string,
    month: number,
    year: number,
    limit: number,
    projectedSpent: number,
  ) {
    super(
      `Limite de presupuesto excedido para categoria ${categoryId} en ${month}/${year}. Limite=${limit}, gasto proyectado=${projectedSpent}`,
    );
  }
}

export class BudgetLimitBelowSpentException extends BudgetException {
  constructor(
    budgetId: string,
    month: number,
    year: number,
    limit: number,
    spent: number,
  ) {
    super(
      `El limite del presupuesto ${budgetId} no puede ser menor al gasto ya registrado en ${month}/${year}. Limite=${limit}, gasto=${spent}`,
    );
  }
}

