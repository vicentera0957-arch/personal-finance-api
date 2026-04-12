import { GetBudgetsByUserIdUseCase } from './get-budgets-by-user-id.use-case';
import { InMemoryBudgetRepository } from '../../infrastructure/persistence/__fakes__/in-memory-budget.repository';
import { makeBudget } from '../../../../test-support/factories';

describe('GetBudgetsByUserIdUseCase', () => {
  let repo: InMemoryBudgetRepository;
  let useCase: GetBudgetsByUserIdUseCase;

  beforeEach(() => {
    repo = new InMemoryBudgetRepository();
    useCase = new GetBudgetsByUserIdUseCase(repo);
  });

  it('should return only the budgets of the user', async () => {
    repo.seed([
      makeBudget({ id: 'b1', userId: 'user-1' }),
      makeBudget({ id: 'b2', userId: 'user-1' }),
      makeBudget({ id: 'b3', userId: 'user-2' }),
    ]);

    const result = await useCase.execute('user-1');

    expect(result.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
  });

  it('should filter by month and year when provided', async () => {
    repo.seed([
      makeBudget({ id: 'b1', userId: 'user-1', month: 1, year: 2026 }),
      makeBudget({ id: 'b2', userId: 'user-1', month: 2, year: 2026 }),
      makeBudget({ id: 'b3', userId: 'user-1', month: 1, year: 2025 }),
    ]);

    const result = await useCase.execute('user-1', { month: 1, year: 2026 });

    expect(result.map((b) => b.id)).toEqual(['b1']);
  });

  it('should return empty array when user has no budgets', async () => {
    const result = await useCase.execute('ghost');

    expect(result).toEqual([]);
  });
});
