// VO que encapsula la naturaleza de una categoría: income o expense.
// Lista cerrada — no puede haber otras naturalezas en V1.
// Separado del TransactionNature del módulo transactions para mantener
// independencia entre bounded contexts (cada dominio evoluciona por separado).

import { InvalidCategoryNatureException } from '../exceptions/category.exceptions';

const VALID_NATURES = ['income', 'expense'] as const;
type Nature = (typeof VALID_NATURES)[number];

export class CategoryNature {
  private readonly value: Nature;

  private constructor(value: Nature) {
    this.value = value;
  }

  private static isValidNature(value: string): value is Nature {
    return (VALID_NATURES as readonly string[]).includes(value);
  }

  static create(value: string): CategoryNature {
    const normalizado = value?.trim().toLowerCase() ?? '';

    if (!normalizado) {
      throw new InvalidCategoryNatureException(value ?? '');
    }

    if (!this.isValidNature(normalizado)) {
      throw new InvalidCategoryNatureException(value);
    }

    return new CategoryNature(normalizado);
  }

  static reconstitute(value: string): CategoryNature {
    return new CategoryNature(value as Nature);
  }

  getValue(): Nature {
    return this.value;
  }

  equals(other: CategoryNature): boolean {
    return this.value === other.value;
  }

  isIncome(): boolean {
    return this.value === 'income';
  }

  isExpense(): boolean {
    return this.value === 'expense';
  }
}
