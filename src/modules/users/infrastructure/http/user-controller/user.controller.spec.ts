import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UsersController } from './user.controller';
import { GetUserByIdUseCase } from '../../../application/use-cases/get-user-by-id.use-case';
import { UpdateUserProfileUseCase } from '../../../application/use-cases/update-user-profile.use-case';
import { DeleteUserUseCase } from '../../../application/use-cases/delete-user.use-case';
import {
  UserNotFoundException,
  InvalidNameException,
} from '../../../domain/exceptions/user.exceptions';
import { ResourceOwnershipException } from '../../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeUser } from '../../../../../test-support/factories';
import type { AuthenticatedUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';

describe('UsersController', () => {
  let controller: UsersController;
  let getUserByIdUseCase: jest.Mocked<GetUserByIdUseCase>;
  let updateUserProfileUseCase: jest.Mocked<UpdateUserProfileUseCase>;
  let deleteUserUseCase: jest.Mocked<DeleteUserUseCase>;

  const currentUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'test@example.com',
  };

  beforeEach(() => {
    getUserByIdUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetUserByIdUseCase>;
    updateUserProfileUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<UpdateUserProfileUseCase>;
    deleteUserUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<DeleteUserUseCase>;

    controller = new UsersController(
      getUserByIdUseCase,
      updateUserProfileUseCase,
      deleteUserUseCase,
    );
  });

  describe('findById', () => {
    it('should return the user as response DTO when found', async () => {
      const user = makeUser({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Alice',
      });
      getUserByIdUseCase.execute.mockResolvedValue(user);

      const result = await controller.findById('user-1', currentUser);

      expect(getUserByIdUseCase.execute).toHaveBeenCalledWith({
        id: 'user-1',
        requestUserId: 'user-1',
      });
      expect(result.id).toBe('user-1');
      expect(result.email).toBe('test@example.com');
      expect(result.name).toBe('Alice');
    });

    it('should map UserNotFoundException to 404', async () => {
      getUserByIdUseCase.execute.mockRejectedValue(
        new UserNotFoundException('user-1'),
      );

      await expect(controller.findById('user-1', currentUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should map ResourceOwnershipException to 403', async () => {
      getUserByIdUseCase.execute.mockRejectedValue(
        new ResourceOwnershipException('user'),
      );

      await expect(controller.findById('user-1', currentUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('updateProfile', () => {
    it('should delegate to use case with body + current user id', async () => {
      const user = makeUser({ id: 'user-1', name: 'Updated' });
      updateUserProfileUseCase.execute.mockResolvedValue(user);

      const result = await controller.updateProfile(
        'user-1',
        { name: 'Updated' },
        currentUser,
      );

      expect(updateUserProfileUseCase.execute).toHaveBeenCalledWith({
        id: 'user-1',
        name: 'Updated',
        requestUserId: 'user-1',
      });
      expect(result.name).toBe('Updated');
    });

    it('should map InvalidNameException to 400', async () => {
      updateUserProfileUseCase.execute.mockRejectedValue(
        new InvalidNameException(),
      );

      await expect(
        controller.updateProfile('user-1', { name: '' }, currentUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('should map UserNotFoundException to 404', async () => {
      updateUserProfileUseCase.execute.mockRejectedValue(
        new UserNotFoundException('user-1'),
      );

      await expect(
        controller.updateProfile('user-1', { name: 'X' }, currentUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should map ResourceOwnershipException to 403', async () => {
      updateUserProfileUseCase.execute.mockRejectedValue(
        new ResourceOwnershipException('user'),
      );

      await expect(
        controller.updateProfile('user-1', { name: 'X' }, currentUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('should invoke the use case with id + current user id and return void', async () => {
      deleteUserUseCase.execute.mockResolvedValue(undefined);

      const result = await controller.delete('user-1', currentUser);

      expect(deleteUserUseCase.execute).toHaveBeenCalledWith({
        id: 'user-1',
        requestUserId: 'user-1',
      });
      expect(result).toBeUndefined();
    });

    it('should map UserNotFoundException to 404', async () => {
      deleteUserUseCase.execute.mockRejectedValue(
        new UserNotFoundException('user-1'),
      );

      await expect(controller.delete('user-1', currentUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should map ResourceOwnershipException to 403', async () => {
      deleteUserUseCase.execute.mockRejectedValue(
        new ResourceOwnershipException('user'),
      );

      await expect(controller.delete('user-1', currentUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
