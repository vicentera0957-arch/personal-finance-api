import { ArchiveAccountUseCase } from './archive-account.use-case';
import { GetAccountByIdUseCase } from './get-account-by-id.use-case';
import { InMemoryAccountRepository } from '../../infrastructure/persistence/__fakes__/in-memory-account.repository';
import { AccountAlreadyArchivedDomainException } from '../../domain/exceptions/account.exceptions';
import { makeAccount } from '../../../../test-support/factories';

describe('ArchiveAccountUseCase', () => {
  let repo: InMemoryAccountRepository;
  let useCase: ArchiveAccountUseCase;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
    useCase = new ArchiveAccountUseCase(repo, new GetAccountByIdUseCase(repo));
  });

  it('should archive an active account', async () => {
    repo.seed([makeAccount({ id: 'a1', userId: 'user-1' })]);

    const result = await useCase.execute({
      id: 'a1',
      requestUserId: 'user-1',
    });

    expect(result.getIsArchived()).toBe(true);
  });

  it('should throw AccountAlreadyArchivedDomainException when already archived', async () => {
    repo.seed([
      makeAccount({ id: 'a1', userId: 'user-1', isArchived: true }),
    ]);

    await expect(
      useCase.execute({ id: 'a1', requestUserId: 'user-1' }),
    ).rejects.toThrow(AccountAlreadyArchivedDomainException);
  });
});
