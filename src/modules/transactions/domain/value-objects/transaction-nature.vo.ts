// VO que encapsula la naturaleza de una transacción: income o expense.
// VO separado de CategoryNature — ver notas.md para la justificación de la duplicación.
// No incluye 'transfer' porque las transferencias son una tabla/entidad aparte.
export class TransactionNature {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  private static readonly valoresValidos = ['income', 'expense'];

  static reconstitute(value: string): TransactionNature {
    return new TransactionNature(value);
  }

  static create(value: string): TransactionNature {
    if (!value || value.trim().length === 0) {
      throw new Error('La naturaleza de la transacción no puede estar vacía');
    }

    const normalizado = value.trim().toLowerCase();

    if (!this.valoresValidos.includes(normalizado)) {
      throw new Error(
        `La naturaleza de la transacción debe ser: ${this.valoresValidos.join(' | ')}`,
      );
    }

    return new TransactionNature(normalizado);
  }

  getValue(): string {
    return this.value;
  }

  equals(other: TransactionNature): boolean {
    return this.value === other.value;
  }

  isIncome(): boolean {
    return this.value === 'income';
  }

  isExpense(): boolean {
    return this.value === 'expense';
  }
}
