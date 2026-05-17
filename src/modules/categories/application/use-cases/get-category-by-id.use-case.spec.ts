import { GetCategoryByIdUseCase } from './get-category-by-id.use-case';
import { InMemoryCategoryRepository } from '../../infrastructure/persistence/__fakes__/in-memory-category.repository';
import { NullCategoriesCache } from '../../infrastructure/cache/__fakes__/null-categories-cache';
import { CategoryNotFoundException } from '../../domain/exceptions/category.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeCategory } from '../../../../test-support/factories';

describe('GetCategoryByIdUseCase', () => {
  let repo: InMemoryCategoryRepository;
  let useCase: GetCategoryByIdUseCase;

  beforeEach(() => {
    repo = new InMemoryCategoryRepository();
    useCase = new GetCategoryByIdUseCase(repo, new NullCategoriesCache());
  });

  it('should return the category when owned by the requester', async () => {
    repo.seed([makeCategory({ id: 'cat-1', userId: 'user-1' })]);

    const result = await useCase.execute('cat-1', 'user-1');

    expect(result.id).toBe('cat-1');
  });

  it('should throw CategoryNotFoundException when missing', async () => {
    await expect(useCase.execute('ghost', 'user-1')).rejects.toThrow(
      CategoryNotFoundException,
    );
  });

  it('should throw ResourceOwnershipException when owned by another user', async () => {
    repo.seed([makeCategory({ id: 'cat-1', userId: 'user-1' })]);

    await expect(useCase.execute('cat-1', 'user-2')).rejects.toThrow(
      ResourceOwnershipException,
    );
  });
});
