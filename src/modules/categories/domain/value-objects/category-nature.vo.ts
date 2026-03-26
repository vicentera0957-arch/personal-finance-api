// VO que encapsula la naturaleza de una categoría: income o expense.
// Lista cerrada — no puede haber otras naturalezas en V1.
// Separado del TransactionNature del módulo transactions para mantener
// independencia entre bounded contexts (cada dominio evoluciona por separado).

export class CategoryNature {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  private static readonly valoresValidos = ['income', 'expense'];

  static create(value: string): CategoryNature {
    if (!value || value.trim().length === 0) {
      throw new Error('La naturaleza de la categoría no puede estar vacía');
    }

    const normalizado = value.trim().toLowerCase();

    if (!this.valoresValidos.includes(normalizado)) {
      throw new Error(
        `La naturaleza de la categoría debe ser: ${this.valoresValidos.join(' | ')}`,
      );
    }

    return new CategoryNature(normalizado);
  }

  getValue(): string {
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
