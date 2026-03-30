import {
  InvalidAccountTypeException,
  NoTypeProvidedException,
} from '../exceptions/account.exceptions';

const VALID_ACCOUNT_TYPES = [
  'ahorro',
  'corriente',
  'vista',
  'ruta',
  'otros',
] as const;
type ValidAccountType = (typeof VALID_ACCOUNT_TYPES)[number];

export class AccountType {
  private readonly tipo: ValidAccountType;

  private constructor(tipo: ValidAccountType) {
    this.tipo = tipo;
  }
  private static isValidType(tipo: string): tipo is ValidAccountType {
    return VALID_ACCOUNT_TYPES.includes(tipo as ValidAccountType);
  }
  //refactor de diseno
  static reconstitute(tipo: string): AccountType {
    if (!this.isValidType(tipo)) {
      throw new InvalidAccountTypeException(tipo);
    }
    return new AccountType(tipo);
  }

  static create(tipo: string): AccountType {
    if (!tipo || tipo.trim().length === 0) {
      throw new NoTypeProvidedException();
    }

    const tipoNormalizado = tipo.trim().toLowerCase();
    if (!this.isValidType(tipoNormalizado)) {
      throw new InvalidAccountTypeException(tipoNormalizado);
    }

    return new AccountType(tipoNormalizado);
  }

  getType(): ValidAccountType {
    return this.tipo;
  }

  equals(other: AccountType): boolean {
    return this.tipo === other.tipo;
  }
}
