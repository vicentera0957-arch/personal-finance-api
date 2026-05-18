import { ExpenseCheckerImpl } from './expense-checker.implement';
import { ITransactionRepository } from '../../domain/repository/transaction.repository';

describe('ExpenseCheckerImpl', () => {
  let txRepo: jest.Mocked<ITransactionRepository>;
  let checker: ExpenseCheckerImpl;

  beforeEach(() => {
    txRepo = {
      sumExpenseAmountByUserCategoryAndPeriod: jest.fn(),
    } as unknown as jest.Mocked<ITransactionRepository>;
    checker = new ExpenseCheckerImpl(txRepo);
  });

  describe('hasExpensesInPeriod', () => {
    it('should return true when the period sum is > 0', async () => {
      txRepo.sumExpenseAmountByUserCategoryAndPeriod.mockResolvedValue(100);

      const result = await checker.hasExpensesInPeriod('user-1', 'c1', 3, 2026);

      expect(result).toBe(true);
      expect(
        txRepo.sumExpenseAmountByUserCategoryAndPeriod,
      ).toHaveBeenCalledWith('user-1', 'c1', 3, 2026);
    });

    it('should return false when the period sum is 0', async () => {
      txRepo.sumExpenseAmountByUserCategoryAndPeriod.mockResolvedValue(0);

      expect(await checker.hasExpensesInPeriod('user-1', 'c1', 3, 2026)).toBe(
        false,
      );
    });
  });
});
