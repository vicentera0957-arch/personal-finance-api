import { RegisterUseCase } from './register.use-case';
import { CreateUserUseCase } from '../../../users/application/use-cases/create-user.use-case';
import { InMemoryUserRepository } from '../../../users/infrastructure/persistence/__fakes__/in-memory-user.repository';
import { IPasswordHasher } from '../../domain/ports/password-hasher.port';
import { ITokenProvider } from '../../domain/ports/token-provider.port';
import { UserAlreadyExistsException } from '../../../users/domain/exceptions/user.exceptions';
import { makeUser } from '../../../../test-support/factories';

describe('RegisterUseCase', () => {
  let registerUseCase: RegisterUseCase;
  let userRepo: InMemoryUserRepository;
  let passwordHasher: jest.Mocked<IPasswordHasher>;
  let tokenProvider: jest.Mocked<ITokenProvider>;

  const mockTokenPair = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };

  beforeEach(() => {
    userRepo = new InMemoryUserRepository();

    passwordHasher = {
      hash: jest.fn().mockResolvedValue('hashed-password'),
      compare: jest.fn(),
    };

    tokenProvider = {
      generateTokens: jest.fn().mockResolvedValue(mockTokenPair),
      verifyAccessToken: jest.fn(),
      verifyRefreshToken: jest.fn(),
    };

    registerUseCase = new RegisterUseCase(
      new CreateUserUseCase(userRepo),
      passwordHasher,
      tokenProvider,
    );
  });

  describe('execute', () => {
    it('should hash password, persist user and return token pair', async () => {
      const result = await registerUseCase.execute({
        name: 'New User',
        email: 'new@example.com',
        password: 'secure-password',
      });

      expect(result).toEqual(mockTokenPair);
      expect(passwordHasher.hash).toHaveBeenCalledWith('secure-password');
      expect(userRepo.size()).toBe(1);

      const persisted = await userRepo.findByEmail('new@example.com');
      expect(persisted?.passwordHash).toBe('hashed-password');
      expect(tokenProvider.generateTokens).toHaveBeenCalledWith({
        sub: persisted!.id,
        email: 'new@example.com',
      });
    });

    it('should propagate UserAlreadyExistsException when email is taken', async () => {
      userRepo.seed([makeUser({ email: 'new@example.com' })]);

      await expect(
        registerUseCase.execute({
          name: 'New User',
          email: 'new@example.com',
          password: 'secure-password',
        }),
      ).rejects.toThrow(UserAlreadyExistsException);

      expect(tokenProvider.generateTokens).not.toHaveBeenCalled();
      expect(userRepo.size()).toBe(1);
    });
  });
});
