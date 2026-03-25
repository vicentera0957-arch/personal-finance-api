import { AccountType } from '../value-objects/type.vo';
import { Balance } from '../value-objects/balance.vo';

// current_balance se omite — una cuenta nueva siempre arranca con el balance inicial

// The object should state its own creation time.
interface CreateAccountProps {
  id: string;
  userId: string;
  name: string;
  type: AccountType;
  initialBalance: Balance;
}

// ReconstituteAccountProps sí necesita currentBalance — puede haber cambiado desde que se creó
interface ReconstituteAccountProps extends CreateAccountProps {
  currentBalance: Balance;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class Account {
  private constructor(
    public readonly id: string,
    public readonly userId: string,
    private name: string,
    public readonly type: AccountType,
    private readonly initialBalance: Balance, // readonly — nunca cambia después de crearse
    private currentBalance: Balance, // mutable — cambia con cada operación
    private isArchived: boolean,
    public readonly createdAt: Date,
    private updatedAt: Date,
  ) {}

  static create(props: CreateAccountProps): Account {
    const now = new Date();
    return new Account(
      props.id,
      props.userId,
      props.name,
      props.type,
      props.initialBalance,
      props.initialBalance, // currentBalance arranca igual al inicial
      false, // una cuenta nueva nunca está archivada
      now,
      now,
    );
  }

  static reconstitute(props: ReconstituteAccountProps): Account {
    return new Account(
      props.id,
      props.userId,
      props.name,
      props.type,
      props.initialBalance,
      props.currentBalance,
      props.isArchived,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ============================================
  // Métodos de negocio — operaciones de balance
  // ============================================

  inflow(amount: Balance): void {
    if (amount.isZero()) {
      throw new Error('El monto de entrada debe ser mayor a cero');
    }
    this.currentBalance = this.currentBalance.add(amount);
    this.updatedAt = new Date();
  }

  outflow(amount: Balance): void {
    if (amount.isZero()) {
      throw new Error('El monto de egreso debe ser mayor a cero');
    }
    this.currentBalance = this.currentBalance.subtract(amount);
    this.updatedAt = new Date();
  }

  hasSufficientFunds(amount: Balance): boolean {
    return (
      this.currentBalance.greaterThan(amount) ||
      this.currentBalance.equals(amount)
    );
  }

  adjustBalance(newBalance: Balance, reason: string): void {
    if (!reason || reason.trim().length === 0) {
      throw new Error('El motivo del ajuste es requerido');
    }
    this.currentBalance = newBalance;
    this.updatedAt = new Date();
  }

  resetToInitialBalance(): void {
    this.currentBalance = this.initialBalance;
    this.updatedAt = new Date();
  }

  // ============================================
  // Métodos de negocio — estado de la cuenta
  // ============================================

  rename(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error('El nombre no puede estar vacío');
    }
    this.name = name.trim();
    this.updatedAt = new Date();
  }

  archive(): void {
    if (this.isArchived) {
      throw new Error('La cuenta ya está archivada');
    }
    this.isArchived = true;
    this.updatedAt = new Date();
  }

  unarchive(): void {
    if (!this.isArchived) {
      throw new Error('La cuenta no está archivada');
    }
    this.isArchived = false;
    this.updatedAt = new Date();
  }

  // ============================================
  // Getters
  // ============================================

  getName(): string {
    return this.name;
  }
  getCurrentBalance(): Balance {
    return this.currentBalance;
  }
  getInitialBalance(): Balance {
    return this.initialBalance;
  }
  getIsArchived(): boolean {
    return this.isArchived;
  }
  getUpdatedAt(): Date {
    return this.updatedAt;
  }
  hasFunds(): boolean {
    return !this.currentBalance.isZero();
  }
}
