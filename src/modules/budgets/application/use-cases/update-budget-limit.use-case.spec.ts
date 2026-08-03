import { Logger } from '@nestjs/common';
import { UpdateBudgetLimitUseCase } from './update-budget-limit.use-case';
import {
  BudgetTxContext,
  IBudgetUnitOfWork,
} from '../../domain/IBudgetUnitOfWork';
import { IExpenseChecker } from '../../domain/ports/expense-checker.port';
import { InMemoryBudgetRepository } from '../../infrastructure/persistence/__fakes__/in-memory-budget.repository';
import {
  BudgetNotFoundException,
  InvalidAmountLimitException,
  BudgetLimitBelowSpentException,
} from '../../domain/exceptions/budget.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeBudget } from '../../../../test-support/factories';
import { NullBudgetsCache } from '../../infrastructure/cache/__fakes__/null-budgets-cache';

class FakeExpenseChecker extends IExpenseChecker {
  constructor(private readonly spentInPeriod: number) {
    super();
  }

  async hasExpensesInPeriod(): Promise<boolean> {
    return this.spentInPeriod > 0;
  }

  async sumExpenseAmountInPeriod(): Promise<number> {
    return this.spentInPeriod;
  }
}

class ExplodingBudgetsCache extends NullBudgetsCache {
  override async invalidateUser(): Promise<void> {
    throw new Error('redis down');
  }
}

describe('UpdateBudgetLimitUseCase', () => {
  let budgetRepo: InMemoryBudgetRepository;
  // `let`, no `const`: test 4 swaps it before calling execute() to simulate
  // getScopedExpenseChecker() returning a different fake for that one case —
  // run()'s mock reads this variable at call time (closure), not at
  // mock-creation time, so the swap is visible.
  let expenseChecker: IExpenseChecker;
  let mockUow: {
    commit: jest.Mock;
    rollback: jest.Mock;
    release: jest.Mock;
    isConnected: jest.Mock;
    run: jest.Mock;
  };
  let useCase: UpdateBudgetLimitUseCase;

  beforeEach(() => {
    budgetRepo = new InMemoryBudgetRepository();
    expenseChecker = new FakeExpenseChecker(0);
    const commit = jest.fn();
    const rollback = jest.fn();
    const release = jest.fn();
    mockUow = {
      commit,
      rollback,
      release,
      // El puerto sigue declarando isConnected() durante la migración (nadie
      // lo llama desde run(), pero el mock lo conserva para no adelantar el
      // recorte del ciclo de vida manual, que es trabajo de un commit futuro).
      isConnected: jest.fn().mockReturnValue(true),
      run: jest.fn(async (work: (ctx: BudgetTxContext) => Promise<unknown>) => {
        try {
          const result = await work({
            budgets: budgetRepo,
            expenses: expenseChecker,
          });
          commit();
          return result;
        } catch (err) {
          rollback();
          throw err;
        } finally {
          release();
        }
      }),
    };
    useCase = new UpdateBudgetLimitUseCase(
      mockUow as unknown as IBudgetUnitOfWork,
      new NullBudgetsCache(),
    );
  });

  it('should update the budget limit within a transaction', async () => {
    budgetRepo.seed([makeBudget({ id: 'b1', userId: 'user-1', limit: 300 })]);

    const result = await useCase.execute({
      id: 'b1',
      requestUserId: 'user-1',
      limit: 800,
    });

    expect(result.getLimit().getValue()).toBe(800);
    expect(mockUow.commit).toHaveBeenCalled();
    expect(mockUow.release).toHaveBeenCalled();
  });

  it('should throw InvalidAmountLimitException when limit is negative', async () => {
    budgetRepo.seed([makeBudget({ id: 'b1', userId: 'user-1' })]);

    await expect(
      useCase.execute({ id: 'b1', requestUserId: 'user-1', limit: -10 }),
    ).rejects.toThrow(InvalidAmountLimitException);

    expect(mockUow.rollback).toHaveBeenCalled();
  });

  it('should throw ResourceOwnershipException when owned by another user', async () => {
    budgetRepo.seed([makeBudget({ id: 'b1', userId: 'user-1' })]);

    await expect(
      useCase.execute({ id: 'b1', requestUserId: 'user-2', limit: 500 }),
    ).rejects.toThrow(ResourceOwnershipException);

    expect(mockUow.rollback).toHaveBeenCalled();
  });

  it('should throw BudgetLimitBelowSpentException when limit is below spent', async () => {
    budgetRepo.seed([makeBudget({ id: 'b1', userId: 'user-1', limit: 800 })]);
    expenseChecker = new FakeExpenseChecker(600);
    const cacheSpy = new NullBudgetsCache();
    jest.spyOn(cacheSpy, 'invalidateUser');
    const spiedUseCase = new UpdateBudgetLimitUseCase(
      mockUow as unknown as IBudgetUnitOfWork,
      cacheSpy,
    );

    await expect(
      spiedUseCase.execute({ id: 'b1', requestUserId: 'user-1', limit: 500 }),
    ).rejects.toThrow(BudgetLimitBelowSpentException);

    expect(mockUow.rollback).toHaveBeenCalled();
    expect(cacheSpy.invalidateUser).not.toHaveBeenCalled();
  });

  it('should throw BudgetNotFoundException when missing', async () => {
    await expect(
      useCase.execute({ id: 'ghost', requestUserId: 'user-1', limit: 500 }),
    ).rejects.toThrow(BudgetNotFoundException);

    expect(mockUow.rollback).toHaveBeenCalled();
  });

  it('should NOT roll back nor propagate when cache invalidation fails after commit', async () => {
    budgetRepo.seed([makeBudget({ id: 'b1', userId: 'user-1', limit: 300 })]);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    const result = await new UpdateBudgetLimitUseCase(
      mockUow as unknown as IBudgetUnitOfWork,
      new ExplodingBudgetsCache(),
    ).execute({ id: 'b1', requestUserId: 'user-1', limit: 800 });

    expect(result.getLimit().getValue()).toBe(800);
    expect(mockUow.commit).toHaveBeenCalledTimes(1);
    expect(mockUow.rollback).not.toHaveBeenCalled();
    expect(mockUow.release).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });
});
