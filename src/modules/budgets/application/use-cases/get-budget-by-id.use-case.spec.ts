import { GetBudgetByIdUseCase } from './get-budget-by-id.use-case';
import { InMemoryBudgetRepository } from '../../infrastructure/persistence/__fakes__/in-memory-budget.repository';
import { NullBudgetsCache } from '../../infrastructure/cache/__fakes__/null-budgets-cache';
import { BudgetNotFoundException } from '../../domain/exceptions/budget.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeBudget } from '../../../../test-support/factories';

describe('GetBudgetByIdUseCase', () => {
  let repo: InMemoryBudgetRepository;
  let useCase: GetBudgetByIdUseCase;

  beforeEach(() => {
    repo = new InMemoryBudgetRepository();
    useCase = new GetBudgetByIdUseCase(repo, new NullBudgetsCache());
  });

  it('should return the budget when owned by requester', async () => {
    repo.seed([makeBudget({ id: 'b1', userId: 'user-1' })]);

    const result = await useCase.execute('b1', 'user-1');

    expect(result.id).toBe('b1');
  });

  it('should throw BudgetNotFoundException when missing', async () => {
    await expect(useCase.execute('ghost', 'user-1')).rejects.toThrow(
      BudgetNotFoundException,
    );
  });

  it('should throw ResourceOwnershipException when owned by another user', async () => {
    repo.seed([makeBudget({ id: 'b1', userId: 'user-1' })]);

    await expect(useCase.execute('b1', 'user-2')).rejects.toThrow(
      ResourceOwnershipException,
    );
  });
});
