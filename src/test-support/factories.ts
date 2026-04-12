// Test factories — domain entity builders for use-case tests.
// Overridable via Partial<> so tests stay DRY while expressing only what matters.

import { User } from '../modules/users/domain/entities/user.entity';
import { Email } from '../modules/users/domain/value-objects/email.vo';

import { Account } from '../modules/accounts/domain/entities/account.entity';
import { AccountType } from '../modules/accounts/domain/value-objects/type.vo';
import { Balance } from '../modules/accounts/domain/value-objects/balance.vo';

import { Category } from '../modules/categories/domain/entities/category.entity';
import { CategoryNature } from '../modules/categories/domain/value-objects/category-nature.vo';

import { Budget } from '../modules/budgets/domain/budget.entity';
import { AmountLimit } from '../modules/budgets/domain/amountlimit.vo';

import { Transaction } from '../modules/transactions/domain/entities/transaction.entity';
import { TransactionNature } from '../modules/transactions/domain/value-objects/transaction-nature.vo';
import { Amount } from '../modules/transactions/domain/value-objects/amount.vo';

// --- User ---

interface UserOverrides {
  id?: string;
  email?: string;
  passwordHash?: string;
  name?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export function makeUser(overrides: UserOverrides = {}): User {
  const now = new Date('2026-01-01T00:00:00Z');
  return User.reconstitute({
    id: overrides.id ?? 'user-1',
    email: Email.create(overrides.email ?? 'test@example.com'),
    passwordHash: overrides.passwordHash ?? 'hashed-password',
    name: overrides.name ?? 'Test User',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  });
}

// --- Account ---

interface AccountOverrides {
  id?: string;
  userId?: string;
  name?: string;
  type?: string;
  initialBalance?: number;
  currentBalance?: number;
  isArchived?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export function makeAccount(overrides: AccountOverrides = {}): Account {
  const now = new Date('2026-01-01T00:00:00Z');
  const initial = overrides.initialBalance ?? 1000;
  return Account.reconstitute({
    id: overrides.id ?? 'account-1',
    userId: overrides.userId ?? 'user-1',
    name: overrides.name ?? 'Main Checking',
    type: AccountType.reconstitute(overrides.type ?? 'corriente'),
    initialBalance: Balance.reconstitute(initial),
    currentBalance: Balance.reconstitute(overrides.currentBalance ?? initial),
    isArchived: overrides.isArchived ?? false,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  });
}

// --- Category ---

interface CategoryOverrides {
  id?: string;
  userId?: string;
  name?: string;
  nature?: 'income' | 'expense';
  isBudgetable?: boolean;
  color?: string;
  icon?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export function makeCategory(overrides: CategoryOverrides = {}): Category {
  const now = new Date('2026-01-01T00:00:00Z');
  return Category.reconstitute({
    id: overrides.id ?? 'category-1',
    userId: overrides.userId ?? 'user-1',
    name: overrides.name ?? 'Groceries',
    nature: CategoryNature.reconstitute(overrides.nature ?? 'expense'),
    isBudgetable: overrides.isBudgetable ?? true,
    color: overrides.color,
    icon: overrides.icon,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  });
}

// --- Budget ---

interface BudgetOverrides {
  id?: string;
  userId?: string;
  categoryId?: string;
  month?: number;
  year?: number;
  limit?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export function makeBudget(overrides: BudgetOverrides = {}): Budget {
  const now = new Date('2026-01-01T00:00:00Z');
  return Budget.reconstitute({
    id: overrides.id ?? 'budget-1',
    userId: overrides.userId ?? 'user-1',
    categoryId: overrides.categoryId ?? 'category-1',
    month: overrides.month ?? 1,
    year: overrides.year ?? 2026,
    limit: AmountLimit.reconstitute(overrides.limit ?? 500),
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  });
}

// --- Transaction ---

interface TransactionOverrides {
  id?: string;
  userId?: string;
  accountId?: string;
  categoryId?: string;
  nature?: 'income' | 'expense';
  amount?: number;
  description?: string;
  transactionDate?: Date;
  createdAt?: Date;
}

export function makeTransaction(
  overrides: TransactionOverrides = {},
): Transaction {
  const date = overrides.transactionDate ?? new Date('2026-01-15T12:00:00Z');
  return Transaction.reconstitute({
    id: overrides.id ?? 'transaction-1',
    userId: overrides.userId ?? 'user-1',
    accountId: overrides.accountId ?? 'account-1',
    categoryId: overrides.categoryId ?? 'category-1',
    nature: TransactionNature.reconstitute(overrides.nature ?? 'expense'),
    amount: Amount.reconstitute(overrides.amount ?? 100),
    description: overrides.description,
    transactionDate: date,
    createdAt: overrides.createdAt ?? date,
  });
}
