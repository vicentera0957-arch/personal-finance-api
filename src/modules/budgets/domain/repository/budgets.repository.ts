import { Budget } from '../budget.entity';

export interface BudgetQueryOptions {
  month?: number;
  year?: number;
}

// Puerto de salida para persistencia de presupuestos.
// Clase abstracta para usarla como token de DI en NestJS.
export abstract class IBudgetRepository {
  abstract findById(id: string): Promise<Budget | null>;
  abstract findByUserId(
    userId: string,
    options?: BudgetQueryOptions,
  ): Promise<Budget[]>;
  abstract findByUserIdAndCategoryIdAndPeriod(
    userId: string,
    categoryId: string,
    month: number,
    year: number,
  ): Promise<Budget | null>;
  abstract save(budget: Budget): Promise<Budget>;
  abstract delete(id: string): Promise<void>;
}
