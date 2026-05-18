import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { CreateTransactionUseCase } from '../../../application/use-cases/create-transaction.use-case';
import { GetTransactionByIdUseCase } from '../../../application/use-cases/get-transaction-by-id.use-case';
import { GetTransactionsByAccountIdUseCase } from '../../../application/use-cases/get-transactions-by-account-id.use-case';
import { GetTransactionsByUserIdUseCase } from '../../../application/use-cases/get-transactions-by-user-id.use-case';
import { DeleteTransactionUseCase } from '../../../application/use-cases/delete-transaction.use-case';
import {
  CannotDeleteTransactionException,
  IncompatibleCategoryNatureException,
  InvalidAmountException,
  TransactionNotFoundException,
} from '../../../domain/exceptions/transaction.exceptions';
import {
  BudgetLimitExceededException,
  BudgetRequiredForExpenseTransactionException,
} from '../../../../budgets/domain/exceptions/budget.exceptions';
import {
  AccountNotFoundException,
  CannotOperateOnArchivedAccountException,
  InsufficientFundsException,
} from '../../../../accounts/domain/exceptions/account.exceptions';
import { CategoryNotFoundException } from '../../../../categories/domain/exceptions/category.exceptions';
import { ResourceOwnershipException } from '../../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeTransaction } from '../../../../../test-support/factories';
import type { AuthenticatedUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';

describe('TransactionsController', () => {
  let controller: TransactionsController;
  let createUseCase: jest.Mocked<CreateTransactionUseCase>;
  let getByIdUseCase: jest.Mocked<GetTransactionByIdUseCase>;
  let getByAccountUseCase: jest.Mocked<GetTransactionsByAccountIdUseCase>;
  let getByUserUseCase: jest.Mocked<GetTransactionsByUserIdUseCase>;
  let deleteUseCase: jest.Mocked<DeleteTransactionUseCase>;

  const currentUser: AuthenticatedUser = { userId: 'user-1', email: 'a@b.cl' };

  beforeEach(() => {
    createUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<CreateTransactionUseCase>;
    getByIdUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetTransactionByIdUseCase>;
    getByAccountUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetTransactionsByAccountIdUseCase>;
    getByUserUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetTransactionsByUserIdUseCase>;
    deleteUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<DeleteTransactionUseCase>;

    controller = new TransactionsController(
      createUseCase,
      getByIdUseCase,
      getByAccountUseCase,
      getByUserUseCase,
      deleteUseCase,
    );
  });

  describe('create', () => {
    it('should parse transactionDate to Date and inject userId from current user', async () => {
      createUseCase.execute.mockResolvedValue(
        makeTransaction({ id: 't1', userId: 'user-1' }),
      );

      await controller.create(
        {
          accountId: 'a1',
          categoryId: 'c1',
          nature: 'expense',
          amount: 50,
          description: 'lunch',
          transactionDate: '2026-03-15T12:00:00.000Z',
        },
        currentUser,
      );

      const call = createUseCase.execute.mock.calls[0][0];
      expect(call.userId).toBe('user-1');
      expect(call.accountId).toBe('a1');
      expect(call.transactionDate).toBeInstanceOf(Date);
      expect(call.transactionDate.toISOString()).toBe(
        '2026-03-15T12:00:00.000Z',
      );
    });

    it('should map AccountNotFoundException to 404', async () => {
      createUseCase.execute.mockRejectedValue(
        new AccountNotFoundException('a1'),
      );

      await expect(
        controller.create(
          {
            accountId: 'a1',
            categoryId: 'c1',
            nature: 'expense',
            amount: 1,
            transactionDate: '2026-03-15T12:00:00.000Z',
          },
          currentUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should map CategoryNotFoundException to 404', async () => {
      createUseCase.execute.mockRejectedValue(
        new CategoryNotFoundException('c1'),
      );

      await expect(
        controller.create(
          {
            accountId: 'a1',
            categoryId: 'c1',
            nature: 'expense',
            amount: 1,
            transactionDate: '2026-03-15T12:00:00.000Z',
          },
          currentUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should map IncompatibleCategoryNatureException to 400', async () => {
      createUseCase.execute.mockRejectedValue(
        new IncompatibleCategoryNatureException('expense', 'income'),
      );

      await expect(
        controller.create(
          {
            accountId: 'a1',
            categoryId: 'c1',
            nature: 'expense',
            amount: 1,
            transactionDate: '2026-03-15T12:00:00.000Z',
          },
          currentUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should map InvalidAmountException to 400', async () => {
      createUseCase.execute.mockRejectedValue(
        new InvalidAmountException('negative'),
      );

      await expect(
        controller.create(
          {
            accountId: 'a1',
            categoryId: 'c1',
            nature: 'expense',
            amount: -1,
            transactionDate: '2026-03-15T12:00:00.000Z',
          },
          currentUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should map BudgetRequiredForExpenseTransactionException to 409', async () => {
      createUseCase.execute.mockRejectedValue(
        new BudgetRequiredForExpenseTransactionException('c1', 3, 2026),
      );

      await expect(
        controller.create(
          {
            accountId: 'a1',
            categoryId: 'c1',
            nature: 'expense',
            amount: 1,
            transactionDate: '2026-03-15T12:00:00.000Z',
          },
          currentUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should map CannotOperateOnArchivedAccountException to 409', async () => {
      createUseCase.execute.mockRejectedValue(
        new CannotOperateOnArchivedAccountException(),
      );

      await expect(
        controller.create(
          {
            accountId: 'a1',
            categoryId: 'c1',
            nature: 'expense',
            amount: 1,
            transactionDate: '2026-03-15T12:00:00.000Z',
          },
          currentUser,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should map BudgetLimitExceededException to 422', async () => {
      createUseCase.execute.mockRejectedValue(
        new BudgetLimitExceededException('c1', 3, 2026, 100, 150),
      );

      await expect(
        controller.create(
          {
            accountId: 'a1',
            categoryId: 'c1',
            nature: 'expense',
            amount: 1,
            transactionDate: '2026-03-15T12:00:00.000Z',
          },
          currentUser,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should map InsufficientFundsException to 422', async () => {
      createUseCase.execute.mockRejectedValue(new InsufficientFundsException());

      await expect(
        controller.create(
          {
            accountId: 'a1',
            categoryId: 'c1',
            nature: 'expense',
            amount: 1,
            transactionDate: '2026-03-15T12:00:00.000Z',
          },
          currentUser,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should map ResourceOwnershipException to 403 (account or category belongs to another user)', async () => {
      createUseCase.execute.mockRejectedValue(
        new ResourceOwnershipException('a1'),
      );

      await expect(
        controller.create(
          {
            accountId: 'a1',
            categoryId: 'c1',
            nature: 'expense',
            amount: 1,
            transactionDate: '2026-03-15T12:00:00.000Z',
          },
          currentUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findByUserId', () => {
    it('should compute offset from page/limit and scope to current user', async () => {
      getByUserUseCase.execute.mockResolvedValue([
        makeTransaction({ id: 't1' }),
      ]);

      await controller.findByUserId(currentUser, {
        page: 2,
        limit: 10,
        from: '2026-03-01',
        to: '2026-03-31',
      });

      expect(getByUserUseCase.execute).toHaveBeenCalledWith('user-1', {
        limit: 10,
        offset: 10,
        from: expect.any(Date),
        to: expect.any(Date),
      });
    });

    it('should leave offset undefined when no pagination given', async () => {
      getByUserUseCase.execute.mockResolvedValue([]);

      await controller.findByUserId(currentUser, {});

      expect(getByUserUseCase.execute).toHaveBeenCalledWith('user-1', {
        limit: undefined,
        offset: undefined,
        from: undefined,
        to: undefined,
      });
    });
  });

  describe('findByAccountId', () => {
    it('should forward accountId, userId and filters', async () => {
      getByAccountUseCase.execute.mockResolvedValue([]);

      await controller.findByAccountId('a1', currentUser, {});

      expect(getByAccountUseCase.execute).toHaveBeenCalledWith('a1', 'user-1', {
        limit: undefined,
        offset: undefined,
        from: undefined,
        to: undefined,
      });
    });
  });

  describe('findById', () => {
    it('should map TransactionNotFoundException to 404', async () => {
      getByIdUseCase.execute.mockRejectedValue(
        new TransactionNotFoundException('t1'),
      );

      await expect(controller.findById('t1', currentUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should map ResourceOwnershipException to 403', async () => {
      getByIdUseCase.execute.mockRejectedValue(
        new ResourceOwnershipException('t1'),
      );

      await expect(controller.findById('t1', currentUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('delete', () => {
    it('should map CannotDeleteTransactionException to 409', async () => {
      deleteUseCase.execute.mockRejectedValue(
        new CannotDeleteTransactionException('t1'),
      );

      await expect(controller.delete('t1', currentUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should map ResourceOwnershipException to 403', async () => {
      deleteUseCase.execute.mockRejectedValue(
        new ResourceOwnershipException('t1'),
      );

      await expect(controller.delete('t1', currentUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should return void on success', async () => {
      deleteUseCase.execute.mockResolvedValue(undefined);

      await controller.delete('t1', currentUser);

      expect(deleteUseCase.execute).toHaveBeenCalledWith('t1', 'user-1');
    });
  });
});
