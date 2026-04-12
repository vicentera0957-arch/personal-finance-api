import { UpdateBudgetLimitUseCase } from './update-budget-limit.use-case';
import { GetBudgetByIdUseCase } from './get-budget-by-id.use-case';
import { InMemoryBudgetRepository } from '../../infrastructure/persistence/__fakes__/in-memory-budget.repository';
import {
  BudgetNotFoundException,
  InvalidAmountLimitException,
} from '../../domain/exceptions/budget.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeBudget } from '../../../../test-support/factories';

describe('UpdateBudgetLimitUseCase', () => {
  let repo: InMemoryBudgetRepository;
  let useCase: UpdateBudgetLimitUseCase;

  beforeEach(() => {
    repo = new InMemoryBudgetRepository();
    useCase = new UpdateBudgetLimitUseCase(repo, new GetBudgetByIdUseCase(repo));
  });

  it('should update the budget limit', async () => {
    repo.seed([makeBudget({ id: 'b1', userId: 'user-1', limit: 300 })]);

    const result = await useCase.execute({
      id: 'b1',
      requestUserId: 'user-1',
      limit: 800,
    });

    expect(result.getLimit().getValue()).toBe(800);
  });

  it('should throw InvalidAmountLimitException when limit is negative', async () => {
    repo.seed([makeBudget({ id: 'b1', userId: 'user-1' })]);

    await expect(
      useCase.execute({ id: 'b1', requestUserId: 'user-1', limit: -10 }),
    ).rejects.toThrow(InvalidAmountLimitException);
  });

  it('should throw ResourceOwnershipException when owned by another user', async () => {
    repo.seed([makeBudget({ id: 'b1', userId: 'user-1' })]);

    await expect(
      useCase.execute({ id: 'b1', requestUserId: 'user-2', limit: 500 }),
    ).rejects.toThrow(ResourceOwnershipException);
  });

  it('should throw BudgetNotFoundException when missing', async () => {
    await expect(
      useCase.execute({ id: 'ghost', requestUserId: 'user-1', limit: 500 }),
    ).rejects.toThrow(BudgetNotFoundException);
  });
});
