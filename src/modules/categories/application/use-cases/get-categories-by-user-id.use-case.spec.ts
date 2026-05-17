import { GetCategoriesByUserIdUseCase } from './get-categories-by-user-id.use-case';
import { InMemoryCategoryRepository } from '../../infrastructure/persistence/__fakes__/in-memory-category.repository';
import { NullCategoriesCache } from '../../infrastructure/cache/__fakes__/null-categories-cache';
import { makeCategory } from '../../../../test-support/factories';

describe('GetCategoriesByUserIdUseCase', () => {
  let repo: InMemoryCategoryRepository;
  let useCase: GetCategoriesByUserIdUseCase;

  beforeEach(() => {
    repo = new InMemoryCategoryRepository();
    useCase = new GetCategoriesByUserIdUseCase(repo, new NullCategoriesCache());
  });

  it('should return only the categories owned by the user', async () => {
    repo.seed([
      makeCategory({ id: 'c1', userId: 'user-1' }),
      makeCategory({ id: 'c2', userId: 'user-1' }),
      makeCategory({ id: 'c3', userId: 'user-2' }),
    ]);

    const result = await useCase.execute('user-1');

    expect(result.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('should return an empty array when the user has no categories', async () => {
    const result = await useCase.execute('user-empty');

    expect(result).toEqual([]);
  });
});
