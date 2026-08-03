import { RenameAccountUseCase } from './rename-account.use-case';
import { InMemoryAccountRepository } from '../../infrastructure/persistence/__fakes__/in-memory-account.repository';
import {
  CannotOperateOnArchivedAccountException,
  AccountNotFoundException,
} from '../../domain/exceptions/account.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeAccount } from '../../../../test-support/factories';
import {
  AccountTxContext,
  IAccountUnitOfWork,
} from '../../domain/IAccountUnitOfWork';

const makeMockUow = (repo: InMemoryAccountRepository) => {
  const commit = jest.fn();
  const rollback = jest.fn();
  const release = jest.fn();
  return {
    commit,
    rollback,
    release,
    run: jest.fn(async (work: (ctx: AccountTxContext) => Promise<unknown>) => {
      try {
        const result = await work({ accounts: repo });
        commit();
        return result;
      } catch (err) {
        rollback();
        throw err;
      } finally {
        release();
      }
    }),
  };
};

describe('RenameAccountUseCase', () => {
  let repo: InMemoryAccountRepository;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
  });

  it('should rename an active account', async () => {
    repo.seed([makeAccount({ id: 'a1', userId: 'user-1', name: 'Old' })]);
    const uow = makeMockUow(repo);

    const result = await new RenameAccountUseCase(
      uow as unknown as IAccountUnitOfWork,
    ).execute({
      id: 'a1',
      name: 'New',
      requestUserId: 'user-1',
    });

    expect(result.getName()).toBe('New');
    expect(uow.commit).toHaveBeenCalledTimes(1);
    expect(uow.release).toHaveBeenCalledTimes(1);
  });

  it('should throw CannotOperateOnArchivedAccountException when archived', async () => {
    repo.seed([makeAccount({ id: 'a1', userId: 'user-1', isArchived: true })]);
    const uow = makeMockUow(repo);

    await expect(
      new RenameAccountUseCase(uow as unknown as IAccountUnitOfWork).execute({
        id: 'a1',
        name: 'X',
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(CannotOperateOnArchivedAccountException);

    expect(uow.rollback).toHaveBeenCalledTimes(1);
    expect(uow.release).toHaveBeenCalledTimes(1);
  });

  it('should throw AccountNotFoundException when account does not exist', async () => {
    const uow = makeMockUow(repo);

    await expect(
      new RenameAccountUseCase(uow as unknown as IAccountUnitOfWork).execute({
        id: 'ghost',
        name: 'X',
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(AccountNotFoundException);

    expect(uow.rollback).toHaveBeenCalledTimes(1);
  });

  it('should throw ResourceOwnershipException when user does not own the account', async () => {
    repo.seed([makeAccount({ id: 'a1', userId: 'owner', name: 'Old' })]);
    const uow = makeMockUow(repo);

    await expect(
      new RenameAccountUseCase(uow as unknown as IAccountUnitOfWork).execute({
        id: 'a1',
        name: 'X',
        requestUserId: 'intruder',
      }),
    ).rejects.toThrow(ResourceOwnershipException);

    expect(uow.rollback).toHaveBeenCalledTimes(1);
  });
});
