import { UpdateCategoryUseCase } from './update-category.use-case';
import { GetCategoryByIdUseCase } from './get-category-by-id.use-case';
import { InMemoryCategoryRepository } from '../../infrastructure/persistence/__fakes__/in-memory-category.repository';
import { NullCategoriesCache } from '../../infrastructure/cache/__fakes__/null-categories-cache';
import { CategoryNotFoundException } from '../../domain/exceptions/category.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeCategory } from '../../../../test-support/factories';

describe('UpdateCategoryUseCase', () => {
  let repo: InMemoryCategoryRepository;
  let useCase: UpdateCategoryUseCase;

  beforeEach(() => {
    repo = new InMemoryCategoryRepository();
    const nullCache = new NullCategoriesCache();
    useCase = new UpdateCategoryUseCase(
      repo,
      new GetCategoryByIdUseCase(repo, nullCache),
      nullCache,
    );
  });

  it('should rename the category when name is provided', async () => {
    repo.seed([makeCategory({ id: 'c1', userId: 'user-1', name: 'Old' })]);

    const result = await useCase.execute({
      id: 'c1',
      requestUserId: 'user-1',
      name: 'New',
    });

    expect(result.getName()).toBe('New');
  });

  it('should throw ResourceOwnershipException when updating another user category', async () => {
    repo.seed([makeCategory({ id: 'c1', userId: 'user-1' })]);

    await expect(
      useCase.execute({ id: 'c1', requestUserId: 'user-2', name: 'Hacker' }),
    ).rejects.toThrow(ResourceOwnershipException);
  });

  it('should throw CategoryNotFoundException when category is missing', async () => {
    await expect(
      useCase.execute({ id: 'ghost', requestUserId: 'user-1', name: 'X' }),
    ).rejects.toThrow(CategoryNotFoundException);
  });
});
