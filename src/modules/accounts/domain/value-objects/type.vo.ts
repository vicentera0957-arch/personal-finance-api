import {
  InvalidAccountTypeException,
  NoTypeProvidedException,
} from '../exceptions/account.exceptions';

export class AccountType {
  private readonly tipo: string;

  private constructor(tipo: string) {
    this.tipo = tipo;
  }

  private static readonly tiposValidos = [
    'ahorro',
    'corriente',
    'vista',
    'ruta',
    'otros',
  ];

  static reconstitute(tipo: string): AccountType {
    return new AccountType(tipo);
  }

  static create(tipo: string): AccountType {
    if (!tipo || tipo.trim().length === 0) {
      throw new NoTypeProvidedException();
    }

    const tipoNormalizado = tipo.trim().toLowerCase();
    if (!this.tiposValidos.includes(tipoNormalizado)) {
      throw new InvalidAccountTypeException(tipoNormalizado);
    }

    return new AccountType(tipoNormalizado);
  }

  getType(): string {
    return this.tipo;
  }

  equals(other: AccountType): boolean {
    return this.tipo === other.tipo;
  }
}
