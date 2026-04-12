import { UnarchiveAccountUseCase } from './unarchive-account.use-case';
import { GetAccountByIdUseCase } from './get-account-by-id.use-case';
import { InMemoryAccountRepository } from '../../infrastructure/persistence/__fakes__/in-memory-account.repository';
import { AccountNotArchivedDomainException } from '../../domain/exceptions/account.exceptions';
import { makeAccount } from '../../../../test-support/factories';

describe('UnarchiveAccountUseCase', () => {
  let repo: InMemoryAccountRepository;
  let useCase: UnarchiveAccountUseCase;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
    useCase = new UnarchiveAccountUseCase(
      repo,
      new GetAccountByIdUseCase(repo),
    );
  });

  it('should unarchive an archived account', async () => {
    repo.seed([
      makeAccount({ id: 'a1', userId: 'user-1', isArchived: true }),
    ]);

    const result = await useCase.execute({
      id: 'a1',
      requestUserId: 'user-1',
    });

    expect(result.getIsArchived()).toBe(false);
  });

  it('should throw AccountNotArchivedDomainException when already active', async () => {
    repo.seed([makeAccount({ id: 'a1', userId: 'user-1' })]);

    await expect(
      useCase.execute({ id: 'a1', requestUserId: 'user-1' }),
    ).rejects.toThrow(AccountNotArchivedDomainException);
  });
});
