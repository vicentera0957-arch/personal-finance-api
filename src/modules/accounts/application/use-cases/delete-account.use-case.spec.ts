import { DeleteAccountUseCase } from './delete-account.use-case';
import { GetAccountByIdUseCase } from './get-account-by-id.use-case';
import { InMemoryAccountRepository } from '../../infrastructure/persistence/__fakes__/in-memory-account.repository';
import { AccountNotFoundException } from '../../domain/exceptions/account.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeAccount } from '../../../../test-support/factories';

describe('DeleteAccountUseCase', () => {
  let repo: InMemoryAccountRepository;
  let useCase: DeleteAccountUseCase;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
    useCase = new DeleteAccountUseCase(repo, new GetAccountByIdUseCase(repo));
  });

  it('should remove the account from the repository', async () => {
    repo.seed([makeAccount({ id: 'a1', userId: 'user-1' })]);

    await useCase.execute({ id: 'a1', requestUserId: 'user-1' });

    expect(repo.size()).toBe(0);
  });

  it('should throw AccountNotFoundException when missing', async () => {
    await expect(
      useCase.execute({ id: 'ghost', requestUserId: 'user-1' }),
    ).rejects.toThrow(AccountNotFoundException);
  });

  it('should throw ResourceOwnershipException when owned by another user', async () => {
    repo.seed([makeAccount({ id: 'a1', userId: 'user-1' })]);

    await expect(
      useCase.execute({ id: 'a1', requestUserId: 'user-2' }),
    ).rejects.toThrow(ResourceOwnershipException);

    expect(repo.size()).toBe(1);
  });
});
