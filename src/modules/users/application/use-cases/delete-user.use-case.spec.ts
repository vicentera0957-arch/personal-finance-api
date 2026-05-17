import { DeleteUserUseCase } from './delete-user.use-case';
import { InMemoryUserRepository } from '../../infrastructure/persistence/__fakes__/in-memory-user.repository';
import { NullUsersCache } from '../../infrastructure/cache/__fakes__/null-users-cache';
import { UserNotFoundException } from '../../domain/exceptions/user.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeUser } from '../../../../test-support/factories';

describe('DeleteUserUseCase', () => {
  let repo: InMemoryUserRepository;
  let useCase: DeleteUserUseCase;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
    useCase = new DeleteUserUseCase(repo, new NullUsersCache());
  });

  it('should remove the user from the repository', async () => {
    repo.seed([makeUser({ id: 'user-1' })]);

    await useCase.execute({ id: 'user-1', requestUserId: 'user-1' });

    expect(repo.size()).toBe(0);
  });

  it('should throw ResourceOwnershipException when deleting another user', async () => {
    repo.seed([makeUser({ id: 'user-1' })]);

    await expect(
      useCase.execute({ id: 'user-1', requestUserId: 'user-2' }),
    ).rejects.toThrow(ResourceOwnershipException);

    expect(repo.size()).toBe(1);
  });

  it('should throw UserNotFoundException when user does not exist', async () => {
    await expect(
      useCase.execute({ id: 'ghost', requestUserId: 'ghost' }),
    ).rejects.toThrow(UserNotFoundException);
  });
});
