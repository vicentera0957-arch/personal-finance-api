export class Balance {
  private readonly value: number;

  private constructor(value: number) {
    this.value = value;
  }

  static create(amount: number): Balance {
    if (!Number.isFinite(amount)) {
      throw new Error('El balance debe ser un número finito');
    }
    if (amount < 0) {
      throw new Error('El balance no puede ser negativo');
    }
    return new Balance(Math.round(amount * 100));
  }

  static zero(): Balance {
    return new Balance(0);
  }

  static reconstitute(cents: number): Balance {
    return new Balance(cents);
  }

  add(other: Balance): Balance {
    return new Balance(this.value + other.value);
  }

  subtract(other: Balance): Balance {
    const result = this.value - other.value;
    if (result < 0) {
      throw new Error('El balance no puede ser negativo');
    }
    return new Balance(result);
  }

  getValue(): number {
    return this.value / 100;
  }

  getCents(): number {
    return this.value;
  }

  toString(): string {
    return (this.value / 100).toFixed(2);
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
