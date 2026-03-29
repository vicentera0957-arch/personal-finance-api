import { InvalidBalanceException } from '../exceptions/account.exceptions';

export class Balance {
  private readonly value: number;

  private constructor(value: number) {
    this.value = value;
  }

  static create(amount: number): Balance {
    if (!Number.isFinite(amount)) {
      throw new InvalidBalanceException('debe ser un número finito');
    }
    if (amount < 0) {
      throw new InvalidBalanceException('no puede ser negativo');
    }
    if (!Number.isInteger(amount)) {
      throw new InvalidBalanceException('no acepta decimales (CLP no tiene centavos)');
    }
    return new Balance(amount);
  }

  static zero(): Balance {
    return new Balance(0);
  }

  static reconstitute(value: number): Balance {
    return new Balance(value);
  }

  add(other: Balance): Balance {
    return new Balance(this.value + other.value);
  }

  subtract(other: Balance): Balance {
    const result = this.value - other.value;
    if (result < 0) {
      throw new InvalidBalanceException('no puede ser negativo');
    }
    return new Balance(result);
  }

  getValue(): number {
    return this.value;
  }

  toString(): string {
    return this.value.toString();
  }

  equals(other: Balance): boolean {
    return this.value === other.value;
  }

  greaterThan(other: Balance): boolean {
    return this.value > other.value;
  }

  isZero(): boolean {
    return this.value === 0;
  }
}
