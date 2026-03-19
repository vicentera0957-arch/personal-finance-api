export abstract class AccountException extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AccountNotFoundException extends AccountException {
  constructor(id: string) {
    super(`Account not found: ${id}`);
  }
}

export class InsufficientFundsException extends AccountException {
  constructor(required: number, available: number) {
    super(`Insufficient funds. Required: ${required}, Available: ${available}`);
  }
}

export class AccountArchivedException extends AccountException {
  constructor(id: string) {
    super(`Account ${id} is archived.`);
  }
}
