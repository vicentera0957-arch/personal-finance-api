import { GetUserByIdUseCase } from './get-user-by-id.use-case';
import { InMemoryUserRepository } from '../../infrastructure/persistence/__fakes__/in-memory-user.repository';
import { NullUsersCache } from '../../infrastructure/cache/__fakes__/null-users-cache';
import { UserNotFoundException } from '../../domain/exceptions/user.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeUser } from '../../../../test-support/factories';

describe('GetUserByIdUseCase', () => {
  let repo: InMemoryUserRepository;
  let useCase: GetUserByIdUseCase;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
    useCase = new GetUserByIdUseCase(repo, new NullUsersCache());
  });

  it('should return the user when id matches requestUserId', async () => {
    repo.seed([makeUser({ id: 'user-1' })]);

    const result = await useCase.execute({
      id: 'user-1',
      requestUserId: 'user-1',
    });

    expect(result.id).toBe('user-1');
  });

  it('should throw ResourceOwnershipException when accessing another user', async () => {
    repo.seed([makeUser({ id: 'user-1' })]);

    await expect(
      useCase.execute({ id: 'user-1', requestUserId: 'user-2' }),
    ).rejects.toThrow(ResourceOwnershipException);
  });

  it('should throw UserNotFoundException when user does not exist', async () => {
    await expect(
      useCase.execute({ id: 'ghost', requestUserId: 'ghost' }),
    ).rejects.toThrow(UserNotFoundException);
  });
});
