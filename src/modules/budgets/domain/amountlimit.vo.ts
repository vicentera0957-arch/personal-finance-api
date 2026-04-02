import { InvalidAmountLimitException } from './exceptions/budget.exceptions';

export class AmountLimit {
  private readonly value: number;

  private constructor(value: number) {
    this.value = value;
  }

  static create(amount: number): AmountLimit {
    if (!Number.isFinite(amount)) {
      throw new InvalidAmountLimitException('debe ser un numero finito');
    }
    if (!Number.isInteger(amount)) {
      throw new InvalidAmountLimitException(
        'debe ser un numero entero (CLP sin decimales)',
      );
    }
    if (amount <= 0) {
      throw new InvalidAmountLimitException('debe ser mayor a cero');
    }

    return new AmountLimit(amount);
  }

  static reconstitute(value: number): AmountLimit {
    return new AmountLimit(value);
  }

  getValue(): number {
    return this.value;
  }

  equals(other: AmountLimit): boolean {
    return this.value === other.value;
  }
}
