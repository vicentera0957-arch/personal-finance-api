import { GetAccountsByUserIdUseCase } from './get-accounts-by-user-id.use-case';
import { InMemoryAccountRepository } from '../../infrastructure/persistence/__fakes__/in-memory-account.repository';
import { makeAccount } from '../../../../test-support/factories';

describe('GetAccountsByUserIdUseCase', () => {
  let repo: InMemoryAccountRepository;
  let useCase: GetAccountsByUserIdUseCase;

  beforeEach(() => {
    repo = new InMemoryAccountRepository();
    useCase = new GetAccountsByUserIdUseCase(repo);
  });

  it('should return only the accounts owned by the user', async () => {
    repo.seed([
      makeAccount({ id: 'a1', userId: 'user-1' }),
      makeAccount({ id: 'a2', userId: 'user-1' }),
      makeAccount({ id: 'a3', userId: 'user-2' }),
    ]);

    const result = await useCase.execute({ userId: 'user-1' });

    expect(result.map((a) => a.id).sort()).toEqual(['a1', 'a2']);
  });

  it('should return an empty array when user has no accounts', async () => {
    const result = await useCase.execute({ userId: 'empty' });

    expect(result).toEqual([]);
  });
});
