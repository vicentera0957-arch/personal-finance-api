// src/modules/users/domain/value-objects/email.vo.ts

export class Email {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static create(raw: string): Email {
    if (!raw || raw.trim().length === 0) {
      throw new Error('El email no puede estar vacío');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(raw.trim())) {
      throw new Error(`Formato de email inválido: ${raw}`);
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
