import { DeleteBudgetUseCase } from './delete-budget.use-case';
import { InMemoryBudgetRepository } from '../../infrastructure/persistence/__fakes__/in-memory-budget.repository';
import {
  BudgetHasTransactionsInPeriodException,
  BudgetNotFoundException,
  BudgetAccessDeniedException,
} from '../../domain/exceptions/budget.exceptions';
import { IExpenseChecker } from '../../domain/repository/expense-checker.port';
import { makeBudget } from '../../../../test-support/factories';

class FakeExpenseChecker extends IExpenseChecker {
  constructor(private readonly value: boolean) { super(); }
  async hasExpensesInPeriod(): Promise<boolean> { return this.value; }
}

const makeMockUow = (budgetRepo: InMemoryBudgetRepository, hasExpenses: boolean) => ({
  begin: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
  isActive: jest.fn().mockReturnValue(true),
  getBudgetRepository: jest.fn().mockReturnValue(budgetRepo),
  getScopedExpenseChecker: jest.fn().mockReturnValue(new FakeExpenseChecker(hasExpenses)),
});

describe('DeleteBudgetUseCase', () => {
  let repo: InMemoryBudgetRepository;

  beforeEach(() => {
    repo = new InMemoryBudgetRepository();
  });

  it('should delete the budget when no expenses exist in the period', async () => {
    repo.seed([makeBudget({ id: 'b1', userId: 'user-1' })]);
    const uow = makeMockUow(repo, false);

    await new DeleteBudgetUseCase(uow as any).execute('b1', 'user-1');

    expect(repo.size()).toBe(0);
    expect(uow.commit).toHaveBeenCalledTimes(1);
    expect(uow.release).toHaveBeenCalledTimes(1);
  });

  it('should throw BudgetHasTransactionsInPeriodException when expenses exist', async () => {
    repo.seed([makeBudget({ id: 'b1', userId: 'user-1' })]);
    const uow = makeMockUow(repo, true);

    await expect(new DeleteBudgetUseCase(uow as any).execute('b1', 'user-1')).rejects.toThrow(
      BudgetHasTransactionsInPeriodException,
    );

    expect(repo.size()).toBe(1);
    expect(uow.rollback).toHaveBeenCalledTimes(1);
    expect(uow.release).toHaveBeenCalledTimes(1);
  });

  it('should throw BudgetNotFoundException when budget does not exist', async () => {
    const uow = makeMockUow(repo, false);

    await expect(new DeleteBudgetUseCase(uow as any).execute('ghost', 'user-1')).rejects.toThrow(
      BudgetNotFoundException,
    );

    expect(uow.rollback).toHaveBeenCalledTimes(1);
  });

  it('should throw BudgetAccessDeniedException when user does not own the budget', async () => {
    repo.seed([makeBudget({ id: 'b1', userId: 'owner' })]);
    const uow = makeMockUow(repo, false);

    await expect(new DeleteBudgetUseCase(uow as any).execute('b1', 'intruder')).rejects.toThrow(
      BudgetAccessDeniedException,
    );

    expect(repo.size()).toBe(1);
    expect(uow.rollback).toHaveBeenCalledTimes(1);
  });
});
