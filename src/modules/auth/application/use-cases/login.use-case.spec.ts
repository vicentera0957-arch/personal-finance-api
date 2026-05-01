import { LoginUseCase } from './login.use-case';
import { GetUserByEmailUseCase } from '../../../users/application/use-cases/get-user-by-email.use-case';
import { InMemoryUserRepository } from '../../../users/infrastructure/persistence/__fakes__/in-memory-user.repository';
import { IPasswordHasher } from '../../domain/ports/password-hasher.port';
import { ITokenProvider } from '../../domain/ports/token-provider.port';
import { InvalidCredentialsException } from '../../domain/exceptions/auth.exceptions';
import { makeUser } from '../../../../test-support/factories';

describe('LoginUseCase', () => {
  let loginUseCase: LoginUseCase;
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
      hash: jest.fn(),
      compare: jest.fn(),
    };

    tokenProvider = {
      generateTokens: jest.fn(),
      verifyAccessToken: jest.fn(),
      verifyRefreshToken: jest.fn(),
    };

    loginUseCase = new LoginUseCase(
      new GetUserByEmailUseCase(userRepo),
      passwordHasher,
      tokenProvider,
    );
  });

  it('should return tokens when credentials are valid', async () => {
    userRepo.seed([
      makeUser({ email: 'test@example.com', passwordHash: 'hashed-password' }),
    ]);
    passwordHasher.compare.mockResolvedValue(true);
    tokenProvider.generateTokens.mockResolvedValue(mockTokenPair);

    const result = await loginUseCase.execute({
      email: 'test@example.com',
      password: 'correct-password',
    });

    expect(result).toEqual(mockTokenPair);
    expect(passwordHasher.compare).toHaveBeenCalledWith(
      'correct-password',
      'hashed-password',
    );
    expect(tokenProvider.generateTokens).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'test@example.com',
    });
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

    expect(tokenProvider.generateTokens).not.toHaveBeenCalled();
  });

  // Timing-attack defense: when user does not exist we STILL call bcrypt.compare
  // (against a dummy hash) and throw the SAME exception as wrong-password.
  // Otherwise latency + exception type leak whether an email is registered.
  it('should throw InvalidCredentialsException (NOT UserNotFoundException) when user does not exist', async () => {
    // repo vacío
    passwordHasher.compare.mockResolvedValue(false);

    await expect(
      loginUseCase.execute({
        email: 'no-user@example.com',
        password: 'any-password',
      }),
    ).rejects.toThrow(InvalidCredentialsException);

    expect(tokenProvider.generateTokens).not.toHaveBeenCalled();
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
