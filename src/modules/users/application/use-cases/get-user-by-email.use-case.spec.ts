import { GetUserByEmailUseCase } from './get-user-by-email.use-case';
import { InMemoryUserRepository } from '../../infrastructure/persistence/__fakes__/in-memory-user.repository';
import {
  EmptyEmailException,
  UserNotFoundException,
} from '../../domain/exceptions/user.exceptions';
import { makeUser } from '../../../../test-support/factories';

describe('GetUserByEmailUseCase', () => {
  let repo: InMemoryUserRepository;
  let useCase: GetUserByEmailUseCase;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
    useCase = new GetUserByEmailUseCase(repo);
  });

  it('should return the user when email exists', async () => {
    repo.seed([makeUser({ email: 'found@example.com' })]);

    const result = await useCase.execute({ email: 'found@example.com' });

    expect(result.email.getValue()).toBe('found@example.com');
  });

  it('should throw UserNotFoundException when email is not registered', async () => {
    await expect(
      useCase.execute({ email: 'ghost@example.com' }),
    ).rejects.toThrow(UserNotFoundException);
  });

  it('should propagate Email VO validation errors', async () => {
    await expect(useCase.execute({ email: '' })).rejects.toThrow(
      EmptyEmailException,
    );
  });
});
