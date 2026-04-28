import { UpdateBudgetLimitUseCase } from './update-budget-limit.use-case';
import { IBudgetUnitOfWork } from '../../domain/IBudgetUnitOfWork';
import { IBudgetRepository } from '../../domain/repository/budgets.repository';
import { InMemoryBudgetRepository } from '../../infrastructure/persistence/__fakes__/in-memory-budget.repository';
import {
  BudgetNotFoundException,
  InvalidAmountLimitException,
  BudgetAccessDeniedException,
} from '../../domain/exceptions/budget.exceptions';
import { makeBudget } from '../../../../test-support/factories';

describe('UpdateBudgetLimitUseCase', () => {
  let budgetRepo: InMemoryBudgetRepository;
  let mockUow: Partial<IBudgetUnitOfWork>;
  let useCase: UpdateBudgetLimitUseCase;

  beforeEach(() => {
    budgetRepo = new InMemoryBudgetRepository();
    mockUow = {
      begin: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isActive: jest.fn().mockReturnValue(true),
      getBudgetRepository: jest.fn().mockReturnValue(budgetRepo),
    };
    useCase = new UpdateBudgetLimitUseCase(
      mockUow as IBudgetUnitOfWork,
      null as any, // getCategoryByIdUseCase not needed for these tests
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
    expect(mockUow.begin).toHaveBeenCalled();
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

  it('should throw BudgetAccessDeniedException when owned by another user', async () => {
    budgetRepo.seed([makeBudget({ id: 'b1', userId: 'user-1' })]);

    await expect(
      useCase.execute({ id: 'b1', requestUserId: 'user-2', limit: 500 }),
    ).rejects.toThrow(BudgetAccessDeniedException);

    expect(mockUow.rollback).toHaveBeenCalled();
  });

  it('should throw BudgetNotFoundException when missing', async () => {
    await expect(
      useCase.execute({ id: 'ghost', requestUserId: 'user-1', limit: 500 }),
    ).rejects.toThrow(BudgetNotFoundException);

    expect(mockUow.rollback).toHaveBeenCalled();
  });
});
