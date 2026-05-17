import { CreateTransactionUseCase } from './create-transaction.use-case';
import { GetAccountByIdUseCase } from '../../../accounts/application/use-cases/get-account-by-id.use-case';
import { GetCategoryByIdUseCase } from '../../../categories/application/use-cases/get-category-by-id.use-case';
import { NullCategoriesCache } from '../../../categories/infrastructure/cache/__fakes__/null-categories-cache';
import { GetBudgetByUserCategoryPeriodUseCase } from '../../../budgets/application/use-cases/get-budget-by-user-category-period.use-case';

import { InMemoryTransactionRepository } from '../../infrastructure/persistence/__fakes__/in-memory-transaction.repository';
import { InMemoryAccountRepository } from '../../../accounts/infrastructure/persistence/__fakes__/in-memory-account.repository';
import { InMemoryCategoryRepository } from '../../../categories/infrastructure/persistence/__fakes__/in-memory-category.repository';
import { InMemoryBudgetRepository } from '../../../budgets/infrastructure/persistence/__fakes__/in-memory-budget.repository';
import { InMemoryUnitOfWork } from '../../infrastructure/persistence/__fakes__/in-memory-unit-of-work';

import { IncompatibleCategoryNatureException } from '../../domain/exceptions/transaction.exceptions';
import {
  BudgetLimitExceededException,
  BudgetRequiredForExpenseTransactionException,
} from '../../../budgets/domain/exceptions/budget.exceptions';

import {
  makeAccount,
  makeBudget,
  makeCategory,
  makeTransaction,
} from '../../../../test-support/factories';

describe('CreateTransactionUseCase', () => {
  let txRepo: InMemoryTransactionRepository;
  let accountRepo: InMemoryAccountRepository;
  let categoryRepo: InMemoryCategoryRepository;
  let budgetRepo: InMemoryBudgetRepository;
  let uow: InMemoryUnitOfWork;
  let useCase: CreateTransactionUseCase;

  const TX_DATE = new Date('2026-03-15T12:00:00Z');

  beforeEach(() => {
    txRepo = new InMemoryTransactionRepository();
    accountRepo = new InMemoryAccountRepository();
    categoryRepo = new InMemoryCategoryRepository();
    budgetRepo = new InMemoryBudgetRepository();
    uow = new InMemoryUnitOfWork(txRepo, accountRepo, budgetRepo);

    useCase = new CreateTransactionUseCase(
      uow,
      new GetAccountByIdUseCase(accountRepo),
      new GetCategoryByIdUseCase(categoryRepo, new NullCategoriesCache()),
      new GetBudgetByUserCategoryPeriodUseCase(budgetRepo),
    );
  });

  const seedValidExpenseContext = (opts: {
    budgetLimit?: number;
    existingSpent?: number;
  } = {}) => {
    accountRepo.seed([
      makeAccount({
        id: 'a1',
        userId: 'user-1',
        initialBalance: 1000,
        currentBalance: 1000,
      }),
    ]);
    categoryRepo.seed([
      makeCategory({
        id: 'cat-1',
        userId: 'user-1',
        nature: 'expense',
      }),
    ]);
    budgetRepo.seed([
      makeBudget({
        id: 'b1',
        userId: 'user-1',
        categoryId: 'cat-1',
        month: 3,
        year: 2026,
        limit: opts.budgetLimit ?? 500,
      }),
    ]);
    if (opts.existingSpent) {
      txRepo.seed([
        makeTransaction({
          id: 'prev',
          userId: 'user-1',
          accountId: 'a1',
          categoryId: 'cat-1',
          nature: 'expense',
          amount: opts.existingSpent,
          transactionDate: TX_DATE,
        }),
      ]);
    }
  };

  it('should create an expense transaction and update account balance', async () => {
    seedValidExpenseContext({ budgetLimit: 500 });

    const result = await useCase.execute({
      userId: 'user-1',
      accountId: 'a1',
      categoryId: 'cat-1',
      nature: 'expense',
      amount: 100,
      transactionDate: TX_DATE,
    });

    expect(result.amount.getValue()).toBe(100);
    expect(txRepo.size()).toBe(1);

    const account = await accountRepo.findById('a1');
    expect(account?.getCurrentBalance().getValue()).toBe(900);
    expect(uow.commits()).toBe(1);
    expect(uow.rollbacks()).toBe(0);
  });

  it('should create an income transaction and increase balance', async () => {
    accountRepo.seed([
      makeAccount({
        id: 'a1',
        userId: 'user-1',
        initialBalance: 100,
        currentBalance: 100,
      }),
    ]);
    categoryRepo.seed([
      makeCategory({
        id: 'cat-1',
        userId: 'user-1',
        nature: 'income',
      }),
    ]);

    const result = await useCase.execute({
      userId: 'user-1',
      accountId: 'a1',
      categoryId: 'cat-1',
      nature: 'income',
      amount: 250,
      transactionDate: TX_DATE,
    });

    expect(result.nature.isIncome()).toBe(true);
    const account = await accountRepo.findById('a1');
    expect(account?.getCurrentBalance().getValue()).toBe(350);
  });

  it('should throw IncompatibleCategoryNatureException when natures differ', async () => {
    accountRepo.seed([makeAccount({ id: 'a1', userId: 'user-1' })]);
    categoryRepo.seed([
      makeCategory({
        id: 'cat-1',
        userId: 'user-1',
        nature: 'income',
      }),
    ]);

    await expect(
      useCase.execute({
        userId: 'user-1',
        accountId: 'a1',
        categoryId: 'cat-1',
        nature: 'expense',
        amount: 50,
        transactionDate: TX_DATE,
      }),
    ).rejects.toThrow(IncompatibleCategoryNatureException);

    expect(txRepo.size()).toBe(0);
  });

  it('should throw BudgetRequiredForExpenseTransactionException when no budget exists', async () => {
    accountRepo.seed([makeAccount({ id: 'a1', userId: 'user-1' })]);
    categoryRepo.seed([
      makeCategory({
        id: 'cat-1',
        userId: 'user-1',
        nature: 'expense',
      }),
    ]);

    await expect(
      useCase.execute({
        userId: 'user-1',
        accountId: 'a1',
        categoryId: 'cat-1',
        nature: 'expense',
        amount: 50,
        transactionDate: TX_DATE,
      }),
    ).rejects.toThrow(BudgetRequiredForExpenseTransactionException);
  });

  it('should throw BudgetLimitExceededException when projected spent exceeds the budget', async () => {
    seedValidExpenseContext({ budgetLimit: 100, existingSpent: 80 });

    await expect(
      useCase.execute({
        userId: 'user-1',
        accountId: 'a1',
        categoryId: 'cat-1',
        nature: 'expense',
        amount: 50,
        transactionDate: TX_DATE,
      }),
    ).rejects.toThrow(BudgetLimitExceededException);

    expect(uow.rollbacks()).toBe(1);
    expect(uow.commits()).toBe(0);
  });
});
