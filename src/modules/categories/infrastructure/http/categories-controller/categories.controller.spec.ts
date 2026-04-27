import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CreateCategoryUseCase } from '../../../application/use-cases/create-category.use-case';
import { GetCategoryByIdUseCase } from '../../../application/use-cases/get-category-by-id.use-case';
import { GetCategoriesByUserIdUseCase } from '../../../application/use-cases/get-categories-by-user-id.use-case';
import { UpdateCategoryUseCase } from '../../../application/use-cases/update-category.use-case';
import { DeleteCategoryUseCase } from '../../../application/use-cases/delete-category.use-case';
import {
  CategoryInUseException,
  CategoryNotFoundException,
  DuplicateCategoryException,
  InvalidCategoryNameException,
} from '../../../domain/exceptions/category.exceptions';
import { ResourceOwnershipException } from '../../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeCategory } from '../../../../../test-support/factories';
import type { AuthenticatedUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';

describe('CategoriesController', () => {
  let controller: CategoriesController;
  let createUseCase: jest.Mocked<CreateCategoryUseCase>;
  let getByIdUseCase: jest.Mocked<GetCategoryByIdUseCase>;
  let getByUserUseCase: jest.Mocked<GetCategoriesByUserIdUseCase>;
  let updateUseCase: jest.Mocked<UpdateCategoryUseCase>;
  let deleteUseCase: jest.Mocked<DeleteCategoryUseCase>;

  const currentUser: AuthenticatedUser = { userId: 'user-1', email: 'a@b.cl' };

  beforeEach(() => {
    createUseCase = { execute: jest.fn() } as unknown as jest.Mocked<CreateCategoryUseCase>;
    getByIdUseCase = { execute: jest.fn() } as unknown as jest.Mocked<GetCategoryByIdUseCase>;
    getByUserUseCase = { execute: jest.fn() } as unknown as jest.Mocked<GetCategoriesByUserIdUseCase>;
    updateUseCase = { execute: jest.fn() } as unknown as jest.Mocked<UpdateCategoryUseCase>;
    deleteUseCase = { execute: jest.fn() } as unknown as jest.Mocked<DeleteCategoryUseCase>;

    controller = new CategoriesController(
      createUseCase,
      getByIdUseCase,
      getByUserUseCase,
      updateUseCase,
      deleteUseCase,
    );
  });

  describe('create', () => {
    it('should delegate with userId from current user', async () => {
      createUseCase.execute.mockResolvedValue(
        makeCategory({ id: 'cat-1', userId: 'user-1', name: 'Food' }),
      );

      await controller.create(
        { name: 'Food', nature: 'expense' },
        currentUser,
      );

      expect(createUseCase.execute).toHaveBeenCalledWith({
        userId: 'user-1',
        name: 'Food',
        nature: 'expense',
        color: undefined,
        icon: undefined,
      });
    });

    it('should map InvalidCategoryNameException to 400', async () => {
      createUseCase.execute.mockRejectedValue(new InvalidCategoryNameException(''));

      await expect(
        controller.create({ name: '', nature: 'expense' }, currentUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should map DuplicateCategoryException to 409', async () => {
      createUseCase.execute.mockRejectedValue(new DuplicateCategoryException('Food', 'expense'));

      await expect(
        controller.create({ name: 'Food', nature: 'expense' }, currentUser),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findByUserId', () => {
    it('should scope to current user', async () => {
      getByUserUseCase.execute.mockResolvedValue([makeCategory({ id: 'c1' })]);

      const result = await controller.findByUserId(currentUser);

      expect(result).toHaveLength(1);
      expect(getByUserUseCase.execute).toHaveBeenCalledWith('user-1');
    });
  });

  describe('findById', () => {
    it('should map CategoryNotFoundException to 404', async () => {
      getByIdUseCase.execute.mockRejectedValue(new CategoryNotFoundException('c1'));

      await expect(controller.findById('c1', currentUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should map ResourceOwnershipException to 403', async () => {
      getByIdUseCase.execute.mockRejectedValue(new ResourceOwnershipException('c1'));

      await expect(controller.findById('c1', currentUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('update', () => {
  });

  describe('delete', () => {
    it('should map CategoryInUseException to 409', async () => {
      deleteUseCase.execute.mockRejectedValue(new CategoryInUseException('c1'));

      await expect(controller.delete('c1', currentUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should return void on success with id + user id', async () => {
      deleteUseCase.execute.mockResolvedValue(undefined);

      await controller.delete('c1', currentUser);

      expect(deleteUseCase.execute).toHaveBeenCalledWith('c1', 'user-1');
    });
  });
});
