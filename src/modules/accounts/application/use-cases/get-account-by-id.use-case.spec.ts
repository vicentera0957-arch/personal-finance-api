import { GetAccountByIdUseCase } from './get-account-by-id.use-case';
import { InMemoryAccountRepository } from '../../infrastructure/persistence/__fakes__/in-memory-account.repository';
import { AccountNotFoundException } from '../../domain/exceptions/account.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeAccount } from '../../../../test-support/factories';

describe('GetAccountByIdUseCase', () => {
  let repo: InMemoryAccountRepository;
  let useCase: GetAccountByIdUseCase;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
    useCase = new GetAccountByIdUseCase(repo);
  });

  it('should return the account when owned by requester', async () => {
    repo.seed([makeAccount({ id: 'a1', userId: 'user-1' })]);

    const result = await useCase.execute({
      id: 'a1',
      requestUserId: 'user-1',
    });

    expect(result.id).toBe('a1');
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
  });
});
