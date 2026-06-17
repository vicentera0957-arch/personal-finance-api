import { RegisterUseCase } from './register.use-case';
import { CreateUserUseCase } from '../../../users/application/use-cases/create-user.use-case';
import { InMemoryUserRepository } from '../../../users/infrastructure/persistence/__fakes__/in-memory-user.repository';
import { InMemoryRefreshTokenRepository } from '../../infrastructure/persistence/__fakes__/in-memory-refresh-token.repository';
import { IPasswordHasher } from '../../domain/ports/password-hasher.port';
import { ITokenProvider } from '../../domain/ports/token-provider.port';
import { UserAlreadyExistsException } from '../../../users/domain/exceptions/user.exceptions';
import { makeUser } from '../../../../test-support/factories';
import { sha256 } from '../utils/token-hash.util';

describe('RegisterUseCase', () => {
  let registerUseCase: RegisterUseCase;
  let userRepo: InMemoryUserRepository;
  let passwordHasher: jest.Mocked<IPasswordHasher>;
  let tokenProvider: jest.Mocked<ITokenProvider>;
  let refreshTokenRepo: InMemoryRefreshTokenRepository;

  const mockTokenPair = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };

  beforeEach(() => {
    userRepo = new InMemoryUserRepository();

    // Thin adapters -> jest.fn (single-call collaborators, no state).
    passwordHasher = {
      hash: jest.fn().mockResolvedValue('hashed-password'),
      compare: jest.fn(),
    };
    tokenProvider = {
      generateAccessToken: jest
        .fn()
        .mockResolvedValue(mockTokenPair.accessToken),
      generateRefreshToken: jest
        .fn()
        .mockResolvedValue(mockTokenPair.refreshToken),
      verifyAccessToken: jest.fn(),
      verifyRefreshToken: jest.fn(),
      getRefreshTokenExpiresAt: jest
        .fn()
        .mockReturnValue(new Date(Date.now() + 86_400_000)),
    };

    // Stateful ports -> InMemory fakes.
    refreshTokenRepo = new InMemoryRefreshTokenRepository();

    registerUseCase = new RegisterUseCase(
      new CreateUserUseCase(userRepo),
      passwordHasher,
      tokenProvider,
      refreshTokenRepo,
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
      expect(tokenProvider.generateAccessToken).toHaveBeenCalledWith({
        sub: persisted!.id,
        email: 'new@example.com',
      });
    });

    it('persists the refresh token after registration', async () => {
      await registerUseCase.execute({
        name: 'New User',
        email: 'new@example.com',
        password: 'secure-password',
      });

      // State-based: the token landed in the store, active.
      expect(refreshTokenRepo.size()).toBe(1);
      const saved = await refreshTokenRepo.findByTokenHash(
        sha256(mockTokenPair.refreshToken),
      );
      expect(saved?.isRevoked()).toBe(false);
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

      expect(tokenProvider.generateAccessToken).not.toHaveBeenCalled();
      expect(refreshTokenRepo.size()).toBe(0);
      expect(userRepo.size()).toBe(1);
    });
  });
});
