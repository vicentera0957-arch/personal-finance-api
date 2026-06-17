import { LoginUseCase } from './login.use-case';
import { GetUserByEmailUseCase } from '../../../users/application/use-cases/get-user-by-email.use-case';
import { InMemoryUserRepository } from '../../../users/infrastructure/persistence/__fakes__/in-memory-user.repository';
import { InMemoryRefreshTokenRepository } from '../../infrastructure/persistence/__fakes__/in-memory-refresh-token.repository';
import { IPasswordHasher } from '../../domain/ports/password-hasher.port';
import { ITokenProvider } from '../../domain/ports/token-provider.port';
import { InvalidCredentialsException } from '../../domain/exceptions/auth.exceptions';
import { makeUser } from '../../../../test-support/factories';
import { sha256 } from '../utils/token-hash.util';

describe('LoginUseCase', () => {
  let loginUseCase: LoginUseCase;
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
      hash: jest.fn(),
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

    loginUseCase = new LoginUseCase(
      new GetUserByEmailUseCase(userRepo),
      passwordHasher,
      tokenProvider,
      refreshTokenRepo,
    );
  });

  it('should return tokens when credentials are valid', async () => {
    userRepo.seed([
      makeUser({ email: 'test@example.com', passwordHash: 'hashed-password' }),
    ]);
    passwordHasher.compare.mockResolvedValue(true);

    const result = await loginUseCase.execute({
      email: 'test@example.com',
      password: 'correct-password',
    });

    expect(result).toEqual(mockTokenPair);
    expect(passwordHasher.compare).toHaveBeenCalledWith(
      'correct-password',
      'hashed-password',
    );
    expect(tokenProvider.generateAccessToken).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'test@example.com',
    });
    expect(tokenProvider.generateRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'user-1', email: 'test@example.com' }),
    );
  });

  it('persists the refresh token after a successful login', async () => {
    userRepo.seed([
      makeUser({ email: 'test@example.com', passwordHash: 'hashed-password' }),
    ]);
    passwordHasher.compare.mockResolvedValue(true);

    await loginUseCase.execute({ email: 'test@example.com', password: 'pw' });

    // State-based: the token landed in the store, owned by the user, active.
    expect(refreshTokenRepo.size()).toBe(1);
    const saved = await refreshTokenRepo.findByTokenHash(
      sha256(mockTokenPair.refreshToken),
    );
    expect(saved?.userId).toBe('user-1');
    expect(saved?.isRevoked()).toBe(false);
  });

  it('should throw InvalidCredentialsException when password is wrong', async () => {
    userRepo.seed([
      makeUser({ email: 'test@example.com', passwordHash: 'hashed-password' }),
    ]);
    passwordHasher.compare.mockResolvedValue(false);

    await expect(
      loginUseCase.execute({
        email: 'test@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toThrow(InvalidCredentialsException);

    expect(tokenProvider.generateAccessToken).not.toHaveBeenCalled();
    expect(refreshTokenRepo.size()).toBe(0);
  });

  // Timing-attack defense: when user does not exist we STILL call bcrypt.compare
  // (against a dummy hash) and throw the SAME exception as wrong-password.
  // Otherwise latency + exception type leak whether an email is registered.
  it('should throw InvalidCredentialsException (NOT UserNotFoundException) when user does not exist', async () => {
    passwordHasher.compare.mockResolvedValue(false);

    await expect(
      loginUseCase.execute({
        email: 'no-user@example.com',
        password: 'any-password',
      }),
    ).rejects.toThrow(InvalidCredentialsException);

    expect(tokenProvider.generateAccessToken).not.toHaveBeenCalled();
  });

  it('should run bcrypt.compare even when user does not exist (timing-safe)', async () => {
    passwordHasher.compare.mockResolvedValue(false);

    await expect(
      loginUseCase.execute({
        email: 'no-user@example.com',
        password: 'whatever',
      }),
    ).rejects.toThrow(InvalidCredentialsException);

    // The key: bcrypt.compare runs even when the user doesn't exist.
    // This ensures the response time doesn't leak whether the email is registered.
    expect(passwordHasher.compare).toHaveBeenCalledTimes(1);
    expect(passwordHasher.compare).toHaveBeenCalledWith(
      'whatever',
      expect.stringMatching(/^\$2[aby]\$/), // bcrypt hash format
    );
  });
});
