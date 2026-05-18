import { LoginUseCase } from './login.use-case';
import { GetUserByEmailUseCase } from '../../../users/application/use-cases/get-user-by-email.use-case';
import { InMemoryUserRepository } from '../../../users/infrastructure/persistence/__fakes__/in-memory-user.repository';
import { IPasswordHasher } from '../../domain/ports/password-hasher.port';
import { ITokenProvider } from '../../domain/ports/token-provider.port';
import { IRefreshTokenRepository } from '../../domain/repository/refresh-token.repository';
import { InvalidCredentialsException } from '../../domain/exceptions/auth.exceptions';
import { makeUser } from '../../../../test-support/factories';

describe('LoginUseCase', () => {
  let loginUseCase: LoginUseCase;
  let userRepo: InMemoryUserRepository;
  let passwordHasher: jest.Mocked<IPasswordHasher>;
  let tokenProvider: jest.Mocked<ITokenProvider>;
  let refreshTokenRepo: jest.Mocked<IRefreshTokenRepository>;

  const mockTokenPair = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };

  beforeEach(() => {
    userRepo = new InMemoryUserRepository();

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

    refreshTokenRepo = {
      findByTokenHash: jest.fn(),
      findByTokenHashWithLock: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
      revokeFamily: jest.fn(),
      deleteExpired: jest.fn(),
    };

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

  it('persiste el refresh token en DB tras un login exitoso', async () => {
    userRepo.seed([
      makeUser({ email: 'test@example.com', passwordHash: 'hashed-password' }),
    ]);
    passwordHasher.compare.mockResolvedValue(true);

    await loginUseCase.execute({ email: 'test@example.com', password: 'pw' });

    expect(refreshTokenRepo.save).toHaveBeenCalledTimes(1);
    const savedToken = (refreshTokenRepo.save as jest.Mock).mock.calls[0][0];
    expect(savedToken.userId).toBe('user-1');
    expect(savedToken.tokenHash).toBeDefined();
    expect(savedToken.isRevoked()).toBe(false);
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
    expect(refreshTokenRepo.save).not.toHaveBeenCalled();
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

    // La clave: bcrypt.compare se llamó igual aunque no exista el user.
    // Esto asegura que el tiempo de respuesta no filtra la existencia del email.
    expect(passwordHasher.compare).toHaveBeenCalledTimes(1);
    expect(passwordHasher.compare).toHaveBeenCalledWith(
      'whatever',
      expect.stringMatching(/^\$2[aby]\$/), // bcrypt hash format
    );
  });
});
