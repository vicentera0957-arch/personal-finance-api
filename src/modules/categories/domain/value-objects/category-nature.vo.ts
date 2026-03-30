// VO que encapsula la naturaleza de una categoría: income o expense.
// Lista cerrada — no puede haber otras naturalezas en V1.
// Separado del TransactionNature del módulo transactions para mantener
// independencia entre bounded contexts (cada dominio evoluciona por separado).

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
    if (!value || value.trim().length === 0) {
      throw new Error('La naturaleza de la categoría no puede estar vacía');
    }

    const normalizado = value.trim().toLowerCase();

    if (!this.isValidNature(normalizado)) {
      throw new Error(
        `La naturaleza de la categoría debe ser: ${VALID_NATURES.join(' | ')}`,
      );
    }

    return new CategoryNature(normalizado);
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
