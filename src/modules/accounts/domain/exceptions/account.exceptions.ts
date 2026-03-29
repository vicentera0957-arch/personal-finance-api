export abstract class AccountException extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AccountNotFoundException extends AccountException {
  constructor(id: string) {
    super(`Cuenta no encontrada: ${id}`);
  }
}

export class InsufficientFundsException extends AccountException {
  constructor() {
    super('Fondos insuficientes para realizar la operación');
  }
}

export class AccountArchivedException extends AccountException {
  constructor(id: string) {
    super(`La cuenta ${id} está archivada`);
  }
}

export class ZeroAmountInflowException extends AccountException {
  constructor() {
    super('El monto de entrada debe ser mayor a cero');
  }
}

export class ZeroAmountOutflowException extends AccountException {
  constructor() {
    super('El monto de egreso debe ser mayor a cero');
  }
}

export class InvalidAdjustmentReasonException extends AccountException {
  constructor() {
    super('El motivo del ajuste es requerido');
  }
}

export class InvalidAccountNameException extends AccountException {
  constructor() {
    super('El nombre no puede estar vacío');
  }
}

export class AccountAlreadyArchivedDomainException extends AccountException {
  constructor() {
    super('La cuenta ya está archivada');
  }
}

export class AccountNotArchivedDomainException extends AccountException {
  constructor() {
    super('La cuenta no está archivada');
  }
}

export class CannotOperateOnArchivedAccountException extends AccountException {
  constructor() {
    super('No se pueden realizar operaciones en una cuenta archivada');
  }
}

// ============================================
// Value Object Exceptions
// ============================================

export class InvalidBalanceException extends AccountException {
  constructor(message: string) {
    super(`Balance inválido: ${message}`);
  }
}

export class InvalidAccountTypeException extends AccountException {
  constructor(type: string) {
    super(`Tipo de cuenta inválido: ${type}. Tipos válidos: ahorro, corriente, vista, ruta, otros`);
  }
}
