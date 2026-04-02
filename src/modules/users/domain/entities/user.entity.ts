import { Email } from '../value-objects/email.vo';
import {
  InvalidNameException,
  InvalidPasswordHashException,
} from '../exceptions/user.exceptions';

// Este tipo agrupa los datos necesarios para crear un usuario nuevo
interface CreateUserProps {
  id: string;
  email: Email;
  passwordHash: string;
  name: string;
}

// Este tipo agrupa los datos cuando reconstruimos desde la DB
// (incluye fechas que ya existen)
interface ReconstituteUserProps extends CreateUserProps {
  createdAt: Date;
  updatedAt: Date;
}

export class User {
  private constructor(
    public readonly id: string,
    public readonly email: Email,
    private passwordHash: string,
    private name: string,
    public readonly createdAt: Date,
    private updatedAt: Date,
  ) {}

  // Para usuarios nuevos — genera las fechas ahora
  static create(props: CreateUserProps): User {
    const normalizedName = User.validateAndNormalizeName(props.name);
    const now = new Date();
    return new User(
      props.id,
      props.email,
      props.passwordHash,
      normalizedName,
      now,
      now,
    );
  }

  // Para reconstruir desde persistencia — respeta fechas originales
  static reconstitute(props: ReconstituteUserProps): User {
    return new User(
      props.id,
      props.email,
      props.passwordHash,
      props.name,
      props.createdAt,
      props.updatedAt,
    );
  }

  private static validateAndNormalizeName(name: string): string {
    if (!name || name.trim().length === 0) {
      throw new InvalidNameException();
    }
    return name.trim();
  }

  // --- Métodos de negocio --- comportamiento propio del usuario

  updateProfile(name: string): void {
    this.name = User.validateAndNormalizeName(name);
    this.updatedAt = new Date();
  }

  changePassword(newHash: string): void {
    if (!newHash) {
      throw new InvalidPasswordHashException();
    }
    this.passwordHash = newHash;
    this.updatedAt = new Date();
  }

  // --- Getters ---
  // Necesarios porque las propiedades son privadas

  getName(): string {
    return this.name;
  }

  getPasswordHash(): string {
    return this.passwordHash;
  }

  getUpdatedAt(): Date {
    return this.updatedAt;
  }
}
