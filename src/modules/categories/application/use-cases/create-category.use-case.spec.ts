import { CreateCategoryUseCase } from './create-category.use-case';
import { InMemoryCategoryRepository } from '../../infrastructure/persistence/__fakes__/in-memory-category.repository';
import { InvalidCategoryNatureException } from '../../domain/exceptions/category.exceptions';

describe('CreateCategoryUseCase', () => {
  let repo: InMemoryCategoryRepository;
  let useCase: CreateCategoryUseCase;

  beforeEach(() => {
    repo = new InMemoryCategoryRepository();
    useCase = new CreateCategoryUseCase(repo);
  });

  it('should persist a new category and return it', async () => {
    const result = await useCase.execute({
      userId: 'user-1',
      name: 'Food',
      nature: 'expense',
    });

    expect(result.userId).toBe('user-1');
    expect(result.nature.getValue()).toBe('expense');
    expect(repo.size()).toBe(1);
  });

  it('should throw InvalidCategoryNatureException when nature is invalid', async () => {
    await expect(
      useCase.execute({
        userId: 'user-1',
        name: 'Food',
        nature: 'bogus',
      }),
    ).rejects.toThrow(InvalidCategoryNatureException);

    expect(repo.size()).toBe(0);
  });
});
