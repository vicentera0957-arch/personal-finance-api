import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { CreateAccountUseCase } from '../../../application/use-cases/create-account.use-case';
import { GetAccountByIdUseCase } from '../../../application/use-cases/get-account-by-id.use-case';
import { GetAccountsByUserIdUseCase } from '../../../application/use-cases/get-accounts-by-user-id.use-case';
import { RenameAccountUseCase } from '../../../application/use-cases/rename-account.use-case';
import { ArchiveAccountUseCase } from '../../../application/use-cases/archive-account.use-case';
import { UnarchiveAccountUseCase } from '../../../application/use-cases/unarchive-account.use-case';
import { DeleteAccountUseCase } from '../../../application/use-cases/delete-account.use-case';
import {
  AccountAlreadyArchivedDomainException,
  AccountInUseException,
  AccountNotArchivedDomainException,
  AccountNotFoundException,
  CannotOperateOnArchivedAccountException,
  InvalidAccountTypeException,
  InvalidBalanceException,
} from '../../../domain/exceptions/account.exceptions';
import { ResourceOwnershipException } from '../../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeAccount } from '../../../../../test-support/factories';
import type { AuthenticatedUser } from '../../../../auth/infrastructure/decorators/current-user.decorator';

describe('AccountsController', () => {
  let controller: AccountsController;
  let createUseCase: jest.Mocked<CreateAccountUseCase>;
  let getByIdUseCase: jest.Mocked<GetAccountByIdUseCase>;
  let getByUserUseCase: jest.Mocked<GetAccountsByUserIdUseCase>;
  let renameUseCase: jest.Mocked<RenameAccountUseCase>;
  let archiveUseCase: jest.Mocked<ArchiveAccountUseCase>;
  let unarchiveUseCase: jest.Mocked<UnarchiveAccountUseCase>;
  let deleteUseCase: jest.Mocked<DeleteAccountUseCase>;

  const currentUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'a@b.cl',
  };

  beforeEach(() => {
    createUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<CreateAccountUseCase>;
    getByIdUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetAccountByIdUseCase>;
    getByUserUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetAccountsByUserIdUseCase>;
    renameUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RenameAccountUseCase>;
    archiveUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<ArchiveAccountUseCase>;
    unarchiveUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<UnarchiveAccountUseCase>;
    deleteUseCase = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<DeleteAccountUseCase>;

    controller = new AccountsController(
      createUseCase,
      getByIdUseCase,
      getByUserUseCase,
      renameUseCase,
      archiveUseCase,
      unarchiveUseCase,
      deleteUseCase,
    );
  });

  describe('create', () => {
    it('should take userId from current user, not body', async () => {
      createUseCase.execute.mockResolvedValue(
        makeAccount({ id: 'acc-1', userId: 'user-1', name: 'Main' }),
      );

      await controller.create(
        { name: 'Main', type: 'corriente', initialBalance: 100 },
        currentUser,
      );

      expect(createUseCase.execute).toHaveBeenCalledWith({
        userId: 'user-1',
        name: 'Main',
        type: 'corriente',
        initialBalance: 100,
      });
    });

    it('should map InvalidAccountTypeException to 400', async () => {
      createUseCase.execute.mockRejectedValue(
        new InvalidAccountTypeException('x'),
      );

      await expect(
        controller.create(
          { name: 'M', type: 'x', initialBalance: 0 },
          currentUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should map InvalidBalanceException to 400', async () => {
      createUseCase.execute.mockRejectedValue(
        new InvalidBalanceException('NaN'),
      );

      await expect(
        controller.create(
          { name: 'M', type: 'corriente', initialBalance: NaN },
          currentUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('should return account DTO when found', async () => {
      getByIdUseCase.execute.mockResolvedValue(
        makeAccount({ id: 'acc-1', userId: 'user-1', initialBalance: 500 }),
      );

      const result = await controller.findById('acc-1', currentUser);

      expect(result.id).toBe('acc-1');
      expect(result.currentBalance).toBe(500);
      expect(getByIdUseCase.execute).toHaveBeenCalledWith({
        id: 'acc-1',
        requestUserId: 'user-1',
      });
    });

    it('should map AccountNotFoundException to 404', async () => {
      getByIdUseCase.execute.mockRejectedValue(
        new AccountNotFoundException('acc-1'),
      );

      await expect(controller.findById('acc-1', currentUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should map ResourceOwnershipException to 403', async () => {
      getByIdUseCase.execute.mockRejectedValue(
        new ResourceOwnershipException('acc-1'),
      );

      await expect(controller.findById('acc-1', currentUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('findByUserId', () => {
    it('should scope to current user and map all to response DTOs', async () => {
      getByUserUseCase.execute.mockResolvedValue([
        makeAccount({ id: 'a' }),
        makeAccount({ id: 'b' }),
      ]);

      const result = await controller.findByUserId(currentUser);

      expect(result).toHaveLength(2);
      expect(getByUserUseCase.execute).toHaveBeenCalledWith({
        userId: 'user-1',
      });
    });
  });

  describe('rename', () => {
    it('should map CannotOperateOnArchivedAccountException to 409', async () => {
      renameUseCase.execute.mockRejectedValue(
        new CannotOperateOnArchivedAccountException(),
      );

      await expect(
        controller.rename('acc-1', { name: 'X' }, currentUser),
      ).rejects.toThrow(ConflictException);
    });

    it('should map AccountNotFoundException to 404', async () => {
      renameUseCase.execute.mockRejectedValue(
        new AccountNotFoundException('acc-1'),
      );

      await expect(
        controller.rename('acc-1', { name: 'X' }, currentUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('archive', () => {
    it('should map AccountAlreadyArchivedDomainException to 409', async () => {
      archiveUseCase.execute.mockRejectedValue(
        new AccountAlreadyArchivedDomainException(),
      );

      await expect(controller.archive('acc-1', currentUser)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('unarchive', () => {
    it('should map AccountNotArchivedDomainException to 409', async () => {
      unarchiveUseCase.execute.mockRejectedValue(
        new AccountNotArchivedDomainException(),
      );

      await expect(controller.unarchive('acc-1', currentUser)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('delete', () => {
    it('should map AccountInUseException to 409', async () => {
      deleteUseCase.execute.mockRejectedValue(
        new AccountInUseException('acc-1'),
      );

      await expect(controller.delete('acc-1', currentUser)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should return void on success', async () => {
      deleteUseCase.execute.mockResolvedValue(undefined);

      const result = await controller.delete('acc-1', currentUser);

      expect(result).toBeUndefined();
      expect(deleteUseCase.execute).toHaveBeenCalledWith({
        id: 'acc-1',
        requestUserId: 'user-1',
      });
    });
  });
});
