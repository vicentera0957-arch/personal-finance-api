import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BudgetsController } from './budgets.controller';
import { CreateBudgetUseCase } from '../../../application/use-cases/create-budget.use-case';
import { GetBudgetByIdUseCase } from '../../../application/use-cases/get-budget-by-id.use-case';
import { GetBudgetsByUserIdUseCase } from '../../../application/use-cases/get-budgets-by-user-id.use-case';
import { UpdateBudgetLimitUseCase } from '../../../application/use-cases/update-budget-limit.use-case';
import { DeleteBudgetUseCase } from '../../../application/use-cases/delete-budget.use-case';
import {
  BudgetAlreadyExistsException,
  BudgetHasTransactionsInPeriodException,
  BudgetNotFoundException,
  InvalidAmountLimitException,
  InvalidBudgetMonthException,
} from '../../../domain/exceptions/budget.exceptions';
import { CategoryNotFoundException } from '../../../../categories/domain/exceptions/category.exceptions';
import { ResourceOwnershipException } from '../../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeBudget } from '../../../../../test-support/factories';
import type { AuthenticatedUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';

describe('BudgetsController', () => {
  let controller: BudgetsController;
  let createUseCase: jest.Mocked<CreateBudgetUseCase>;
  let getByIdUseCase: jest.Mocked<GetBudgetByIdUseCase>;
  let getByUserUseCase: jest.Mocked<GetBudgetsByUserIdUseCase>;
  let updateLimitUseCase: jest.Mocked<UpdateBudgetLimitUseCase>;
  let deleteUseCase: jest.Mocked<DeleteBudgetUseCase>;

  const currentUser: AuthenticatedUser = { userId: 'user-1', email: 'a@b.cl' };

  beforeEach(() => {
    createUseCase = { execute: jest.fn() } as unknown as jest.Mocked<CreateBudgetUseCase>;
    getByIdUseCase = { execute: jest.fn() } as unknown as jest.Mocked<GetBudgetByIdUseCase>;
    getByUserUseCase = { execute: jest.fn() } as unknown as jest.Mocked<GetBudgetsByUserIdUseCase>;
    updateLimitUseCase = { execute: jest.fn() } as unknown as jest.Mocked<UpdateBudgetLimitUseCase>;
    deleteUseCase = { execute: jest.fn() } as unknown as jest.Mocked<DeleteBudgetUseCase>;

    controller = new BudgetsController(
      createUseCase,
      getByIdUseCase,
      getByUserUseCase,
      updateLimitUseCase,
      deleteUseCase,
    );
  });

  describe('create', () => {
    it('should delegate with userId from current user', async () => {
      createUseCase.execute.mockResolvedValue(
        makeBudget({ id: 'b1', userId: 'user-1' }),
      );

      await controller.create(
        { categoryId: 'c1', month: 3, year: 2026, limit: 500 },
        currentUser,
      );

      expect(createUseCase.execute).toHaveBeenCalledWith({
        userId: 'user-1',
        categoryId: 'c1',
        month: 3,
        year: 2026,
        limit: 500,
      });
    });

    it('should map CategoryNotFoundException to 404', async () => {
      createUseCase.execute.mockRejectedValue(new CategoryNotFoundException('c1'));

      await expect(
        controller.create({ categoryId: 'c1', month: 3, year: 2026, limit: 1 }, currentUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should map InvalidBudgetMonthException to 400', async () => {
      createUseCase.execute.mockRejectedValue(new InvalidBudgetMonthException(13));

      await expect(
        controller.create({ categoryId: 'c1', month: 13, year: 2026, limit: 1 }, currentUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should map InvalidAmountLimitException to 400', async () => {
      createUseCase.execute.mockRejectedValue(new InvalidAmountLimitException('negative'));

      await expect(
        controller.create({ categoryId: 'c1', month: 3, year: 2026, limit: -1 }, currentUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should map BudgetAlreadyExistsException to 409', async () => {
      createUseCase.execute.mockRejectedValue(
        new BudgetAlreadyExistsException('user-1', 'c1', 3, 2026),
      );

      await expect(
        controller.create({ categoryId: 'c1', month: 3, year: 2026, limit: 1 }, currentUser),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findByUserId', () => {
    it('should forward optional month and year filters', async () => {
      getByUserUseCase.execute.mockResolvedValue([makeBudget({ id: 'b1' })]);

      const result = await controller.findByUserId(currentUser, { month: 3, year: 2026 });

      expect(result).toHaveLength(1);
      expect(getByUserUseCase.execute).toHaveBeenCalledWith('user-1', {
        month: 3,
        year: 2026,
      });
    });
  });

  describe('findById', () => {
    it('should map BudgetNotFoundException to 404', async () => {
      getByIdUseCase.execute.mockRejectedValue(new BudgetNotFoundException('b1'));

      await expect(controller.findById('b1', currentUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should map ResourceOwnershipException to 403', async () => {
      getByIdUseCase.execute.mockRejectedValue(new ResourceOwnershipException('b1'));

      await expect(controller.findById('b1', currentUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('updateLimit', () => {
    it('should map InvalidAmountLimitException to 400', async () => {
      updateLimitUseCase.execute.mockRejectedValue(new InvalidAmountLimitException('bad'));

      await expect(
        controller.updateLimit('b1', { limit: -1 }, currentUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete', () => {
    it('should map BudgetHasTransactionsInPeriodException to 409', async () => {
      deleteUseCase.execute.mockRejectedValue(
        new BudgetHasTransactionsInPeriodException('b1', 3, 2026),
      );

      await expect(controller.delete('b1', currentUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should return void and invoke use case with id + user id', async () => {
      deleteUseCase.execute.mockResolvedValue(undefined);

      await controller.delete('b1', currentUser);

      expect(deleteUseCase.execute).toHaveBeenCalledWith('b1', 'user-1');
    });
  });
});
