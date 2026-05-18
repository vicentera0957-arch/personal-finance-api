import { Account } from './account.entity';
import { AccountType } from '../value-objects/type.vo';
import { Balance } from '../value-objects/balance.vo';
import {
  InvalidAccountNameException,
  CannotOperateOnArchivedAccountException,
  ZeroAmountInflowException,
  ZeroAmountOutflowException,
  AccountAlreadyArchivedDomainException,
  AccountNotArchivedDomainException,
  InsufficientFundsException,
} from '../exceptions/account.exceptions';

describe('Account', () => {
  const createValidAccount = (
    overrides?: Partial<Parameters<typeof Account.create>[0]>,
  ) => {
    return Account.create({
      id: '123',
      userId: 'user1',
      name: 'Checking Account',
      type: AccountType.create('corriente'),
      initialBalance: Balance.create(1000),
      ...overrides,
    });
  };

  describe('create', () => {
    it('should create an account with valid properties', () => {
      const account = createValidAccount();

      expect(account.id).toBe('123');
      expect(account.userId).toBe('user1');
      expect(account.getName()).toBe('Checking Account');
      expect(account.getIsArchived()).toBe(false);
      expect(account.getCurrentBalance().getValue()).toBe(1000);
      expect(account.getInitialBalance().getValue()).toBe(1000);
    });

    it('should set createdAt and updatedAt to now', () => {
      const beforeCreation = new Date();
      const account = createValidAccount();
      const afterCreation = new Date();

      expect(account.createdAt.getTime()).toBeGreaterThanOrEqual(
        beforeCreation.getTime(),
      );
      expect(account.createdAt.getTime()).toBeLessThanOrEqual(
        afterCreation.getTime(),
      );
      expect(account.getUpdatedAt()).toEqual(account.createdAt);
    });

    it('should normalize account name by trimming whitespace', () => {
      const account = Account.create({
        id: '123',
        userId: 'user1',
        name: '  Savings  ',
        type: AccountType.create('ahorro'),
        initialBalance: Balance.create(500),
      });

      expect(account.getName()).toBe('Savings');
    });

    it('should throw InvalidAccountNameException if name is empty string', () => {
      expect(() => createValidAccount({ name: '' })).toThrow(
        InvalidAccountNameException,
      );
    });

    it('should throw InvalidAccountNameException if name is only whitespace', () => {
      expect(() => createValidAccount({ name: '   ' })).toThrow(
        InvalidAccountNameException,
      );
      expect(() => createValidAccount({ name: '\t\n' })).toThrow(
        InvalidAccountNameException,
      );
    });

    it('should always start with isArchived=false', () => {
      const account = createValidAccount();
      expect(account.getIsArchived()).toBe(false);
    });

    it('should set currentBalance equal to initialBalance on creation', () => {
      const initialBalance = Balance.create(2000);
      const account = Account.create({
        id: '123',
        userId: 'user1',
        name: 'Test Account',
        type: AccountType.create('ahorro'),
        initialBalance,
      });

      expect(account.getCurrentBalance()).toEqual(initialBalance);
    });
  });

  describe('reconstitute', () => {
    it('should reconstitute an account from persisted data', () => {
      const createdAt = new Date('2024-01-01');
      const updatedAt = new Date('2024-01-15');

      const account = Account.reconstitute({
        id: '456',
        userId: 'user2',
        name: 'Reconstituted Account',
        type: AccountType.create('vista'),
        initialBalance: Balance.create(5000),
        currentBalance: Balance.create(3500),
        isArchived: true,
        createdAt,
        updatedAt,
      });

      expect(account.id).toBe('456');
      expect(account.getName()).toBe('Reconstituted Account');
      expect(account.getCurrentBalance().getValue()).toBe(3500);
      expect(account.getIsArchived()).toBe(true);
      expect(account.createdAt).toEqual(createdAt);
      expect(account.getUpdatedAt()).toEqual(updatedAt);
    });

    it('should preserve all dates exactly as provided', () => {
      const createdAt = new Date('2023-06-01T10:30:00Z');
      const updatedAt = new Date('2024-02-15T14:45:30Z');

      const account = Account.reconstitute({
        id: '789',
        userId: 'user3',
        name: 'Test',
        type: AccountType.create('ruta'),
        initialBalance: Balance.create(1000),
        currentBalance: Balance.create(1000),
        isArchived: false,
        createdAt,
        updatedAt,
      });

      expect(account.createdAt.getTime()).toBe(createdAt.getTime());
      expect(account.getUpdatedAt().getTime()).toBe(updatedAt.getTime());
    });
  });

  describe('inflow', () => {
    it('should increase balance when account is not archived', () => {
      const account = createValidAccount();
      const originalBalance = account.getCurrentBalance().getValue();

      account.inflow(Balance.create(500));

      expect(account.getCurrentBalance().getValue()).toBe(
        originalBalance + 500,
      );
    });

    it('should update updatedAt timestamp', () => {
      const account = createValidAccount();
      const originalUpdatedAt = account.getUpdatedAt().getTime();

      // Small delay to ensure timestamp differs
      account.inflow(Balance.create(100));

      expect(account.getUpdatedAt().getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt,
      );
    });

    it('should throw CannotOperateOnArchivedAccountException if account is archived', () => {
      const account = createValidAccount();
      account.archive();

      expect(() => account.inflow(Balance.create(100))).toThrow(
        CannotOperateOnArchivedAccountException,
      );
    });

    it('should throw ZeroAmountInflowException if amount is zero', () => {
      const account = createValidAccount();

      expect(() => account.inflow(Balance.zero())).toThrow(
        ZeroAmountInflowException,
      );
    });

    it('should allow multiple consecutive inflows', () => {
      const account = createValidAccount();
      account.inflow(Balance.create(100));
      account.inflow(Balance.create(200));

      expect(account.getCurrentBalance().getValue()).toBe(1300);
    });
  });

  describe('outflow', () => {
    it('should decrease balance when account is not archived', () => {
      const account = createValidAccount();
      const originalBalance = account.getCurrentBalance().getValue();

      account.outflow(Balance.create(300));

      expect(account.getCurrentBalance().getValue()).toBe(
        originalBalance - 300,
      );
    });

    it('should update updatedAt timestamp', () => {
      const account = createValidAccount();
      const originalUpdatedAt = account.getUpdatedAt().getTime();

      account.outflow(Balance.create(100));

      expect(account.getUpdatedAt().getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt,
      );
    });

    it('should throw CannotOperateOnArchivedAccountException if account is archived', () => {
      const account = createValidAccount();
      account.archive();

      expect(() => account.outflow(Balance.create(100))).toThrow(
        CannotOperateOnArchivedAccountException,
      );
    });

    it('should throw ZeroAmountOutflowException if amount is zero', () => {
      const account = createValidAccount();

      expect(() => account.outflow(Balance.zero())).toThrow(
        ZeroAmountOutflowException,
      );
    });

    it('should throw InsufficientFundsException if balance would go negative', () => {
      const account = createValidAccount(); // balance = 1000

      expect(() => account.outflow(Balance.create(1001))).toThrow(
        InsufficientFundsException,
      );
    });

    it('should allow outflow that leaves zero balance', () => {
      const account = Account.create({
        id: '123',
        userId: 'user1',
        name: 'Test',
        type: AccountType.create('ahorro'),
        initialBalance: Balance.create(100),
      });

      expect(() => account.outflow(Balance.create(100))).not.toThrow();
      expect(account.getCurrentBalance().getValue()).toBe(0);
    });

    it('should allow multiple consecutive outflows', () => {
      const account = createValidAccount();
      account.outflow(Balance.create(300));
      account.outflow(Balance.create(200));

      expect(account.getCurrentBalance().getValue()).toBe(500);
    });
  });

  describe('hasSufficientFunds', () => {
    it('should return true when balance is greater than amount', () => {
      const account = createValidAccount(); // balance = 1000

      expect(account.hasSufficientFunds(Balance.create(500))).toBe(true);
    });

    it('should return true when balance equals amount', () => {
      const account = createValidAccount(); // balance = 1000

      expect(account.hasSufficientFunds(Balance.create(1000))).toBe(true);
    });

    it('should return false when balance is less than amount', () => {
      const account = createValidAccount(); // balance = 1000

      expect(account.hasSufficientFunds(Balance.create(1001))).toBe(false);
    });

    it('should return false when balance is zero and amount is positive', () => {
      const account = Account.create({
        id: '123',
        userId: 'user1',
        name: 'Test',
        type: AccountType.create('ahorro'),
        initialBalance: Balance.create(0),
      });

      expect(account.hasSufficientFunds(Balance.create(1))).toBe(false);
    });
  });

  describe('rename', () => {
    it('should rename account when not archived', () => {
      const account = createValidAccount();

      account.rename('New Account Name');

      expect(account.getName()).toBe('New Account Name');
    });

    it('should normalize name by trimming whitespace', () => {
      const account = createValidAccount();

      account.rename('  Trimmed Name  ');

      expect(account.getName()).toBe('Trimmed Name');
    });

    it('should update updatedAt timestamp when renaming', () => {
      const account = createValidAccount();
      const originalUpdatedAt = account.getUpdatedAt().getTime();

      account.rename('New Name');

      expect(account.getUpdatedAt().getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt,
      );
    });

    it('should throw CannotOperateOnArchivedAccountException if archived', () => {
      const account = createValidAccount();
      account.archive();

      expect(() => account.rename('New Name')).toThrow(
        CannotOperateOnArchivedAccountException,
      );
    });

    it('should throw InvalidAccountNameException if new name is empty', () => {
      const account = createValidAccount();

      expect(() => account.rename('')).toThrow(InvalidAccountNameException);
    });

    it('should throw InvalidAccountNameException if new name is only whitespace', () => {
      const account = createValidAccount();

      expect(() => account.rename('   ')).toThrow(InvalidAccountNameException);
    });
  });

  describe('archive', () => {
    it('should archive an account when not already archived', () => {
      const account = createValidAccount();
      expect(account.getIsArchived()).toBe(false);

      account.archive();

      expect(account.getIsArchived()).toBe(true);
    });

    it('should update updatedAt when archiving', () => {
      const account = createValidAccount();
      const originalUpdatedAt = account.getUpdatedAt().getTime();

      account.archive();

      expect(account.getUpdatedAt().getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt,
      );
    });

    it('should throw AccountAlreadyArchivedDomainException if already archived', () => {
      const account = createValidAccount();
      account.archive();

      expect(() => account.archive()).toThrow(
        AccountAlreadyArchivedDomainException,
      );
    });
  });

  describe('unarchive', () => {
    it('should unarchive an account when currently archived', () => {
      const account = createValidAccount();
      account.archive();
      expect(account.getIsArchived()).toBe(true);

      account.unarchive();

      expect(account.getIsArchived()).toBe(false);
    });

    it('should update updatedAt when unarchiving', () => {
      const account = createValidAccount();
      account.archive();
      const originalUpdatedAt = account.getUpdatedAt().getTime();

      account.unarchive();

      expect(account.getUpdatedAt().getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt,
      );
    });

    it('should throw AccountNotArchivedDomainException if not archived', () => {
      const account = createValidAccount();
      expect(account.getIsArchived()).toBe(false);

      expect(() => account.unarchive()).toThrow(
        AccountNotArchivedDomainException,
      );
    });

    it('should allow archive/unarchive cycles', () => {
      const account = createValidAccount();

      account.archive();
      expect(account.getIsArchived()).toBe(true);

      account.unarchive();
      expect(account.getIsArchived()).toBe(false);

      account.archive();
      expect(account.getIsArchived()).toBe(true);
    });
  });

  describe('hasFunds', () => {
    it('should return true when balance is greater than zero', () => {
      const account = createValidAccount();
      expect(account.hasFunds()).toBe(true);
    });

    it('should return false when balance is zero', () => {
      const account = Account.create({
        id: '123',
        userId: 'user1',
        name: 'Empty Account',
        type: AccountType.create('ahorro'),
        initialBalance: Balance.create(0),
      });

      expect(account.hasFunds()).toBe(false);
    });

    it('should return false after spending all funds', () => {
      const account = Account.create({
        id: '123',
        userId: 'user1',
        name: 'Test',
        type: AccountType.create('ahorro'),
        initialBalance: Balance.create(100),
      });

      account.outflow(Balance.create(100));

      expect(account.hasFunds()).toBe(false);
    });
  });

  describe('getters', () => {
    it('should return correct values from all getters', () => {
      const accountType = AccountType.create('corriente');
      const initialBalance = Balance.create(2000);
      const account = Account.create({
        id: 'test-id',
        userId: 'test-user',
        name: 'Test Account',
        type: accountType,
        initialBalance,
      });

      expect(account.getName()).toBe('Test Account');
      expect(account.getInitialBalance().getValue()).toBe(2000);
      expect(account.getCurrentBalance().getValue()).toBe(2000);
      expect(account.getIsArchived()).toBe(false);
      expect(account.type).toBe(accountType);
      expect(account.userId).toBe('test-user');
      expect(account.id).toBe('test-id');
    });
  });

  describe('archived account restrictions', () => {
    it('should prevent all mutations on archived account', () => {
      const account = createValidAccount();
      account.archive();

      expect(() => account.inflow(Balance.create(100))).toThrow(
        CannotOperateOnArchivedAccountException,
      );
      expect(() => account.outflow(Balance.create(100))).toThrow(
        CannotOperateOnArchivedAccountException,
      );
      expect(() => account.rename('New Name')).toThrow(
        CannotOperateOnArchivedAccountException,
      );
    });

    it('should allow reading from archived account', () => {
      const account = createValidAccount();
      account.archive();

      expect(() => account.getName()).not.toThrow();
      expect(() => account.getCurrentBalance()).not.toThrow();
      expect(() => account.getIsArchived()).not.toThrow();
      expect(() =>
        account.hasSufficientFunds(Balance.create(100)),
      ).not.toThrow();
    });

    it('should allow unarchive to restore mutability', () => {
      const account = createValidAccount();
      account.archive();
      account.unarchive();

      expect(() => account.rename('Restored')).not.toThrow();
      expect(account.getName()).toBe('Restored');
    });
  });
});
