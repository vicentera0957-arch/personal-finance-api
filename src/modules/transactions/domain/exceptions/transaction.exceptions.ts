// Base abstracta para excepciones del dominio de transacciones.
export abstract class TransactionException extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// Se lanza cuando no se encuentra una transacción por su id.
export class TransactionNotFoundException extends TransactionException {
  constructor(id: string) {
    super(`Transacción no encontrada: ${id}`);
  }
}

// Se lanza cuando eliminar una transacción income dejaría el balance de la cuenta negativo.
// Ocurre cuando el saldo actual es menor que el monto original del ingreso que se quiere revertir.
export class CannotDeleteTransactionException extends TransactionException {
  constructor(transactionId: string) {
    super(
      `No se puede eliminar la transacción ${transactionId} porque revertiría el balance de la cuenta a negativo`,
    );
  }
}

// Se lanza cuando la naturaleza de la categoría no coincide con la de la transacción (R7).
export class IncompatibleCategoryNatureException extends TransactionException {
  constructor(transactionNature: string, categoryNature: string) {
    super(
      `La naturaleza de la transacción (${transactionNature}) no coincide con la de la categoría (${categoryNature})`,
    );
  }
}

// ============================================
// Value Object Exceptions
// ============================================

export class InvalidAmountException extends TransactionException {
  constructor(message: string) {
    super(`Monto inválido: ${message}`);
  }
}

export class EmptyTransactionNatureException extends TransactionException {
  constructor() {
    super('La naturaleza de la transacción no puede estar vacía');
  }
}

export class InvalidTransactionNatureException extends TransactionException {
  constructor(value: string) {
    super(
      `Naturaleza de transacción inválida: "${value}". Valores válidos: income | expense`,
    );
  }
}
