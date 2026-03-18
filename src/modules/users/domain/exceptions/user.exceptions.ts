// src/modules/users/domain/exceptions/user.exceptions.ts

// Nota importante: estas clases extienden Error, NO HttpException.
// La traducción a HTTP (404, 409, etc.) ocurre en el controlador,
// no acá. El dominio no sabe que existe HTTP.

export class UserNotFoundException extends Error {
  constructor(identifier: string) {
    super(`Usuario no encontrado: ${identifier}`);
    this.name = 'UserNotFoundException';
  }
}

export class UserAlreadyExistsException extends Error {
  constructor(email: string) {
    super(`Ya existe un usuario con el email: ${email}`);
    this.name = 'UserAlreadyExistsException';
  }
}

export class InvalidCredentialsException extends Error {
  constructor() {
    super('Las credenciales proporcionadas son inválidas');
    this.name = 'InvalidCredentialsException';
  }
}
