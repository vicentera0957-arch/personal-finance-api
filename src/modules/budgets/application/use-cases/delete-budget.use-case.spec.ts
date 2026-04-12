import { DeleteBudgetUseCase } from './delete-budget.use-case';
import { GetBudgetByIdUseCase } from './get-budget-by-id.use-case';
import { InMemoryBudgetRepository } from '../../infrastructure/persistence/__fakes__/in-memory-budget.repository';
import {
  BudgetHasTransactionsInPeriodException,
  BudgetNotFoundException,
} from '../../domain/exceptions/budget.exceptions';
import { IExpenseChecker } from '../../domain/repository/expense-checker.port';
import { makeBudget } from '../../../../test-support/factories';

class FakeExpenseChecker extends IExpenseChecker {
  constructor(private readonly value: boolean) {
    super();
  }
  async hasExpensesInPeriod(): Promise<boolean> {
    return this.value;
  }
}

describe('DeleteBudgetUseCase', () => {
  let repo: InMemoryBudgetRepository;

  beforeEach(() => {
    repo = new InMemoryBudgetRepository();
  });

  const makeUseCase = (hasExpenses: boolean) =>
    new DeleteBudgetUseCase(
      repo,
      new GetBudgetByIdUseCase(repo),
      new FakeExpenseChecker(hasExpenses),
    );

  it('should delete the budget when no expenses exist in the period', async () => {
    repo.seed([makeBudget({ id: 'b1', userId: 'user-1' })]);

    await makeUseCase(false).execute('b1', 'user-1');

    expect(repo.size()).toBe(0);
  });

  it('should throw BudgetHasTransactionsInPeriodException when expenses exist', async () => {
    repo.seed([makeBudget({ id: 'b1', userId: 'user-1' })]);

    await expect(makeUseCase(true).execute('b1', 'user-1')).rejects.toThrow(
      BudgetHasTransactionsInPeriodException,
    );

    expect(repo.size()).toBe(1);
  });

  it('should throw BudgetNotFoundException when missing', async () => {
    await expect(makeUseCase(false).execute('ghost', 'user-1')).rejects.toThrow(
      BudgetNotFoundException,
    );
  });
});
