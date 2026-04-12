import { CreateUserUseCase } from './create-user.use-case';
import { InMemoryUserRepository } from '../../infrastructure/persistence/__fakes__/in-memory-user.repository';
import { UserAlreadyExistsException } from '../../domain/exceptions/user.exceptions';
import { EmptyEmailException } from '../../domain/exceptions/user.exceptions';
import { makeUser } from '../../../../test-support/factories';

describe('CreateUserUseCase', () => {
  let repo: InMemoryUserRepository;
  let useCase: CreateUserUseCase;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
    useCase = new CreateUserUseCase(repo);
  });

  it('should persist a new user and return it', async () => {
    const result = await useCase.execute({
      email: 'new@example.com',
      passwordHash: 'hash',
      name: 'New User',
    });

    expect(result.email.getValue()).toBe('new@example.com');
    expect(result.getName()).toBe('New User');
    expect(repo.size()).toBe(1);
  });

  it('should assign a fresh uuid to each new user', async () => {
    const a = await useCase.execute({
      email: 'a@example.com',
      passwordHash: 'h',
      name: 'A',
    });
    const b = await useCase.execute({
      email: 'b@example.com',
      passwordHash: 'h',
      name: 'B',
    });

    expect(a.id).not.toBe(b.id);
    expect(a.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('should throw UserAlreadyExistsException when email is taken', async () => {
    repo.seed([makeUser({ email: 'taken@example.com' })]);

    await expect(
      useCase.execute({
        email: 'taken@example.com',
        passwordHash: 'hash',
        name: 'Dup',
      }),
    ).rejects.toThrow(UserAlreadyExistsException);

    expect(repo.size()).toBe(1);
  });

  it('should propagate Email VO validation errors', async () => {
    await expect(
      useCase.execute({ email: '', passwordHash: 'h', name: 'X' }),
    ).rejects.toThrow(EmptyEmailException);

    expect(repo.size()).toBe(0);
  });
});
