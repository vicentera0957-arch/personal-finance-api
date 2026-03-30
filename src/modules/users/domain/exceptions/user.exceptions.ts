// src/modules/users/domain/exceptions/user.exceptions.ts

// Nota importante: estas clases extienden Error, NO HttpException.
// La traducción a HTTP (404, 409, etc.) ocurre en el controlador,
// no acá. El dominio no sabe que existe HTTP.
export abstract class UserException extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UserNotFoundException extends UserException {
  constructor(identifier: string) {
    super(`Usuario no encontrado: ${identifier}`);
  }
}

export class UserAlreadyExistsException extends UserException {
  constructor(email: string) {
    super(`Ya existe un usuario con el email: ${email}`);
  }
}

export class InvalidCredentialsException extends UserException {
  constructor() {
    super('Las credenciales proporcionadas son inválidas');
  }
}

// ============================================
// Value Object Exceptions
// ============================================

export class InvalidEmailFormatException extends UserException {
  constructor(email: string) {
    super(`Formato de email inválido: ${email}`);
  }
}

export class EmptyEmailException extends UserException {
  constructor() {
    super('El email no puede estar vacío');
  }
}

// ============================================
// Entity Exceptions
// ============================================

export class InvalidNameException extends UserException {
  constructor() {
    super('El nombre no puede estar vacío');
  }
}

export class InvalidPasswordHashException extends UserException {
  constructor() {
    super('El hash de contraseña no puede estar vacío');
  }
}
