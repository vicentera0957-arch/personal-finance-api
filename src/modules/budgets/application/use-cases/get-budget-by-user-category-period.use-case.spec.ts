import { GetBudgetByUserCategoryPeriodUseCase } from './get-budget-by-user-category-period.use-case';
import { InMemoryBudgetRepository } from '../../infrastructure/persistence/__fakes__/in-memory-budget.repository';
import { makeBudget } from '../../../../test-support/factories';

describe('GetBudgetByUserCategoryPeriodUseCase', () => {
  let repo: InMemoryBudgetRepository;
  let useCase: GetBudgetByUserCategoryPeriodUseCase;

  beforeEach(() => {
    repo = new InMemoryBudgetRepository();
    useCase = new GetBudgetByUserCategoryPeriodUseCase(repo);
  });

  it('should return the matching budget', async () => {
    repo.seed([
      makeBudget({
        id: 'b1',
        userId: 'user-1',
        categoryId: 'cat-1',
        month: 3,
        year: 2026,
      }),
    ]);

    const result = await useCase.execute({
      userId: 'user-1',
      categoryId: 'cat-1',
      month: 3,
      year: 2026,
    });

    expect(result?.id).toBe('b1');
  });

  it('should return null when no budget matches', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      categoryId: 'cat-1',
      month: 3,
      year: 2026,
    });

    expect(result).toBeNull();
  });
});
