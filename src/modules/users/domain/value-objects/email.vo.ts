import {
  EmptyEmailException,
  InvalidEmailFormatException,
} from '../exceptions/user.exceptions';

export class Email {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static reconstitute(raw: string): Email {
    return new Email(raw);
  }

  static create(raw: string): Email {
    if (!raw || raw.trim().length === 0) {
      throw new EmptyEmailException();
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(raw.trim())) {
      throw new InvalidEmailFormatException(raw);
    }

    return new Email(raw.toLowerCase().trim());
  }

  getValue(): string {
    return this.value;
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  getDomain(): string {
    return this.value.split('@')[1];
  }
}
