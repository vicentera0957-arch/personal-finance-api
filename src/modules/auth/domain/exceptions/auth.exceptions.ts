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

export class InvalidRefreshTokenException extends AuthException {
  constructor() {
    super('Refresh token inválido');
  }
}

export class RefreshTokenRevokedException extends AuthException {
  constructor() {
    super('Refresh token revocado');
  }
}

export class RefreshTokenExpiredException extends AuthException {
  constructor() {
    super('Refresh token expirado');
  }
}

/** Se lanza cuando se detecta replay: alguien usó un token ya rotado. */
export class RefreshTokenReplayDetectedException extends AuthException {
  constructor() {
    super('Replay detectado: sesión revocada por seguridad');
  }
}
