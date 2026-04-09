// Excepciones de dominio del módulo auth.
// Extienden Error, nunca HttpException. El controller traduce a HTTP.
export abstract class AuthException extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InvalidCredentialsException extends AuthException {
  constructor() {
    super('Las credenciales proporcionadas son inválidas');
  }
}
