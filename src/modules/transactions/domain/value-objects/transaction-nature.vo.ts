import {
  EmptyTransactionNatureException,
  InvalidTransactionNatureException,
} from '../exceptions/transaction.exceptions';

// VO: naturaleza de transacción (income | expense).
// Separado de CategoryNature — ver notas.md.
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
      throw new EmptyTransactionNatureException();
    }

    const normalizado = value.trim().toLowerCase();

    if (!this.valoresValidos.includes(normalizado)) {
      throw new InvalidTransactionNatureException(value);
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
