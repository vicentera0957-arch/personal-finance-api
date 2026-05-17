import { CreateBudgetUseCase } from './create-budget.use-case';
import { GetCategoryByIdUseCase } from '../../../categories/application/use-cases/get-category-by-id.use-case';
import { InMemoryBudgetRepository } from '../../infrastructure/persistence/__fakes__/in-memory-budget.repository';
import { InMemoryCategoryRepository } from '../../../categories/infrastructure/persistence/__fakes__/in-memory-category.repository';
import { NullCategoriesCache } from '../../../categories/infrastructure/cache/__fakes__/null-categories-cache';
import { NullBudgetsCache } from '../../infrastructure/cache/__fakes__/null-budgets-cache';
import {
  BudgetAlreadyExistsException,
  BudgetCategoryMustBeExpenseException,
} from '../../domain/exceptions/budget.exceptions';
import { CategoryNotFoundException } from '../../../categories/domain/exceptions/category.exceptions';
import { makeBudget, makeCategory } from '../../../../test-support/factories';

describe('CreateBudgetUseCase', () => {
  let budgetRepo: InMemoryBudgetRepository;
  let categoryRepo: InMemoryCategoryRepository;
  let useCase: CreateBudgetUseCase;

  beforeEach(() => {
    budgetRepo = new InMemoryBudgetRepository();
    categoryRepo = new InMemoryCategoryRepository();
    useCase = new CreateBudgetUseCase(
      budgetRepo,
      new GetCategoryByIdUseCase(categoryRepo, new NullCategoriesCache()),
      new NullBudgetsCache(),
    );
  });

  const seedValidCategory = () =>
    categoryRepo.seed([
      makeCategory({
        id: 'cat-1',
        userId: 'user-1',
        nature: 'expense',
      }),
    ]);

  it('should create a budget when category is budgetable expense and no duplicate exists', async () => {
    seedValidCategory();

    const result = await useCase.execute({
      userId: 'user-1',
      categoryId: 'cat-1',
      month: 3,
      year: 2026,
      limit: 500,
    });

    expect(result.userId).toBe('user-1');
    expect(result.getLimit().getValue()).toBe(500);
    expect(budgetRepo.size()).toBe(1);
  });

  it('should throw BudgetCategoryMustBeExpenseException when category is income', async () => {
    categoryRepo.seed([
      makeCategory({
        id: 'cat-1',
        userId: 'user-1',
        nature: 'income',
      }),
    ]);

    await expect(
      useCase.execute({
        userId: 'user-1',
        categoryId: 'cat-1',
        month: 3,
        year: 2026,
        limit: 500,
      }),
    ).rejects.toThrow(BudgetCategoryMustBeExpenseException);
  });

  it('should throw BudgetAlreadyExistsException when one exists for the period', async () => {
    seedValidCategory();
    budgetRepo.seed([
      makeBudget({
        id: 'b1',
        userId: 'user-1',
        categoryId: 'cat-1',
        month: 3,
        year: 2026,
      }),
    ]);

    await expect(
      useCase.execute({
        userId: 'user-1',
        categoryId: 'cat-1',
        month: 3,
        year: 2026,
        limit: 500,
      }),
    ).rejects.toThrow(BudgetAlreadyExistsException);
  });

  it('should propagate CategoryNotFoundException when category is missing', async () => {
    await expect(
      useCase.execute({
        userId: 'user-1',
        categoryId: 'ghost',
        month: 3,
        year: 2026,
        limit: 500,
      }),
    ).rejects.toThrow(CategoryNotFoundException);
  });
});
