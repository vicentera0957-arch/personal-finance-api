import { ArchiveAccountUseCase } from './archive-account.use-case';
import { InMemoryAccountRepository } from '../../infrastructure/persistence/__fakes__/in-memory-account.repository';
import {
  AccountAlreadyArchivedDomainException,
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
    // El puerto sigue declarando isConnected() durante la migración (nadie
    // lo llama desde run(), pero el mock lo conserva para no adelantar el
    // recorte del ciclo de vida manual, que es trabajo de un commit futuro).
    isConnected: jest.fn().mockReturnValue(true),
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

describe('ArchiveAccountUseCase', () => {
  let repo: InMemoryAccountRepository;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
  });

  it('should archive an active account', async () => {
    repo.seed([makeAccount({ id: 'a1', userId: 'user-1' })]);
    const uow = makeMockUow(repo);

    const result = await new ArchiveAccountUseCase(
      uow as unknown as IAccountUnitOfWork,
    ).execute({
      id: 'a1',
      requestUserId: 'user-1',
    });

    expect(result.getIsArchived()).toBe(true);
    expect(uow.commit).toHaveBeenCalledTimes(1);
    expect(uow.release).toHaveBeenCalledTimes(1);
  });

  it('should throw AccountAlreadyArchivedDomainException when already archived', async () => {
    repo.seed([makeAccount({ id: 'a1', userId: 'user-1', isArchived: true })]);
    const uow = makeMockUow(repo);

    await expect(
      new ArchiveAccountUseCase(uow as unknown as IAccountUnitOfWork).execute({
        id: 'a1',
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(AccountAlreadyArchivedDomainException);

    expect(uow.rollback).toHaveBeenCalledTimes(1);
    expect(uow.release).toHaveBeenCalledTimes(1);
  });

  it('should throw AccountNotFoundException when account does not exist', async () => {
    const uow = makeMockUow(repo);

    await expect(
      new ArchiveAccountUseCase(uow as unknown as IAccountUnitOfWork).execute({
        id: 'ghost',
        requestUserId: 'user-1',
      }),
    ).rejects.toThrow(AccountNotFoundException);

    expect(uow.rollback).toHaveBeenCalledTimes(1);
  });

  it('should throw ResourceOwnershipException when user does not own the account', async () => {
    repo.seed([makeAccount({ id: 'a1', userId: 'owner' })]);
    const uow = makeMockUow(repo);

    await expect(
      new ArchiveAccountUseCase(uow as unknown as IAccountUnitOfWork).execute({
        id: 'a1',
        requestUserId: 'intruder',
      }),
    ).rejects.toThrow(ResourceOwnershipException);

    expect(uow.rollback).toHaveBeenCalledTimes(1);
  });
});
