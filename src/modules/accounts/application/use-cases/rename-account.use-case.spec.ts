import { RenameAccountUseCase } from './rename-account.use-case';
import { GetAccountByIdUseCase } from './get-account-by-id.use-case';
import { InMemoryAccountRepository } from '../../infrastructure/persistence/__fakes__/in-memory-account.repository';
import { CannotOperateOnArchivedAccountException } from '../../domain/exceptions/account.exceptions';
import { makeAccount } from '../../../../test-support/factories';

describe('RenameAccountUseCase', () => {
  let repo: InMemoryAccountRepository;
  let useCase: RenameAccountUseCase;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
    useCase = new RenameAccountUseCase(repo, new GetAccountByIdUseCase(repo));
  });

  it('should rename an active account', async () => {
    repo.seed([
      makeAccount({ id: 'a1', userId: 'user-1', name: 'Old' }),
    ]);

    const result = await useCase.execute({
      id: 'a1',
      name: 'New',
      requestUserId: 'user-1',
    });

    expect(result.getName()).toBe('New');
  });

  it('should throw CannotOperateOnArchivedAccountException when archived', async () => {
    repo.seed([
      makeAccount({ id: 'a1', userId: 'user-1', isArchived: true }),
    ]);

    await expect(
      useCase.execute({ id: 'a1', name: 'X', requestUserId: 'user-1' }),
    ).rejects.toThrow(CannotOperateOnArchivedAccountException);
  });
});
