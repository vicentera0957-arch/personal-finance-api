import { UpdateUserProfileUseCase } from './update-user-profile.use-case';
import { GetUserByIdUseCase } from './get-user-by-id.use-case';
import { InMemoryUserRepository } from '../../infrastructure/persistence/__fakes__/in-memory-user.repository';
import { NullUsersCache } from '../../infrastructure/cache/__fakes__/null-users-cache';
import { UserNotFoundException } from '../../domain/exceptions/user.exceptions';
import { ResourceOwnershipException } from '../../../../shared/domain/exceptions/resource-ownership.exception';
import { makeUser } from '../../../../test-support/factories';

describe('UpdateUserProfileUseCase', () => {
  let repo: InMemoryUserRepository;
  let useCase: UpdateUserProfileUseCase;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
    const nullCache = new NullUsersCache();
    useCase = new UpdateUserProfileUseCase(
      repo,
      new GetUserByIdUseCase(repo, nullCache),
      nullCache,
    );
  });

  it('should update name when provided', async () => {
    repo.seed([makeUser({ id: 'user-1', name: 'Old Name' })]);

    const result = await useCase.execute({
      id: 'user-1',
      requestUserId: 'user-1',
      name: 'New Name',
    });

    expect(result.getName()).toBe('New Name');
  });

  it('should leave name unchanged when not provided', async () => {
    repo.seed([makeUser({ id: 'user-1', name: 'Stable' })]);

    const result = await useCase.execute({
      id: 'user-1',
      requestUserId: 'user-1',
    });

    expect(result.getName()).toBe('Stable');
  });

  it('should throw ResourceOwnershipException when updating another user', async () => {
    repo.seed([makeUser({ id: 'user-1' })]);

    await expect(
      useCase.execute({
        id: 'user-1',
        requestUserId: 'user-2',
        name: 'Hacker',
      }),
    ).rejects.toThrow(ResourceOwnershipException);
  });

  it('should throw UserNotFoundException when user does not exist', async () => {
    await expect(
      useCase.execute({ id: 'ghost', requestUserId: 'ghost', name: 'Nope' }),
    ).rejects.toThrow(UserNotFoundException);
  });
});
