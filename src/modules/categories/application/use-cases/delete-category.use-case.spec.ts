import { DeleteCategoryUseCase } from './delete-category.use-case';
import { GetCategoryByIdUseCase } from './get-category-by-id.use-case';
import { InMemoryCategoryRepository } from '../../infrastructure/persistence/__fakes__/in-memory-category.repository';
import { CategoryNotFoundException } from '../../domain/exceptions/category.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeCategory } from '../../../../test-support/factories';

describe('DeleteCategoryUseCase', () => {
  let repo: InMemoryCategoryRepository;
  let useCase: DeleteCategoryUseCase;

  beforeEach(() => {
    repo = new InMemoryCategoryRepository();
    useCase = new DeleteCategoryUseCase(repo, new GetCategoryByIdUseCase(repo));
  });

  it('should remove the category from the repository', async () => {
    repo.seed([makeCategory({ id: 'c1', userId: 'user-1' })]);

    await useCase.execute('c1', 'user-1');

    expect(repo.size()).toBe(0);
  });

  it('should throw CategoryNotFoundException when category is missing', async () => {
    await expect(useCase.execute('ghost', 'user-1')).rejects.toThrow(
      CategoryNotFoundException,
    );
  });

  it('should throw ResourceOwnershipException when owned by another user', async () => {
    repo.seed([makeCategory({ id: 'c1', userId: 'user-1' })]);

    await expect(useCase.execute('c1', 'user-2')).rejects.toThrow(
      ResourceOwnershipException,
    );

    expect(repo.size()).toBe(1);
  });
});
