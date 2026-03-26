// VO que encapsula el monto de una transacción en CLP.
// Diferencias con Balance (accounts):
//   - Amount > 0 estrictamente (R4: el monto debe ser positivo)
//   - Balance >= 0 (puede ser cero)
// Ver notas.md para la justificación de mantener VOs separados.
export class Amount {
  private readonly value: number;

  private constructor(value: number) {
    this.value = value;
  }

  static create(amount: number): Amount {
    if (!Number.isFinite(amount)) {
      throw new Error('El monto debe ser un número finito');
    }
    if (!Number.isInteger(amount)) {
      throw new Error('El monto debe ser un número entero (CLP sin decimales)');
    }
    if (amount <= 0) {
      throw new Error('El monto debe ser mayor a cero (R4)');
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
