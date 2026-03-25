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
