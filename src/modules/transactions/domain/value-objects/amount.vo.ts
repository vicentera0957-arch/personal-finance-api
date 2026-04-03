import { InvalidAmountException } from '../exceptions/transaction.exceptions';

// VO que encapsula el monto de una transacción en CLP.
// Amount > 0 estrictamente (R4). Balance (accounts) >= 0.
export class Amount {
  private readonly value: number;

  private constructor(value: number) {
    this.value = value;
  }

  static create(amount: number): Amount {
    if (!Number.isFinite(amount)) {
      throw new InvalidAmountException('debe ser un número finito');
    }
    if (!Number.isInteger(amount)) {
      throw new InvalidAmountException(
        'debe ser un número entero (CLP sin decimales)',
      );
    }
    if (amount <= 0) {
      throw new InvalidAmountException('debe ser mayor a cero');
    }
    return new Amount(amount);
  }

  // Para reconstruir desde la DB sin re-validar
  static reconstitute(value: number): Amount {
    return new Amount(value);
  }

  getValue(): number {
    return this.value;
  }

  equals(other: Amount): boolean {
    return this.value === other.value;
  }
}
