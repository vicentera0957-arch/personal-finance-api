import { LoginUseCase } from './login.use-case';
import { GetUserByEmailUseCase } from '../../../users/application/use-cases/get-user-by-email.use-case';
import { IPasswordHasher } from '../../domain/ports/password-hasher.port';
import { ITokenProvider } from '../../domain/ports/token-provider.port';
import { User } from '../../../users/domain/entities/user.entity';
import { Email } from '../../../users/domain/value-objects/email.vo';
import {
  InvalidCredentialsException,
  UserNotFoundException,
} from '../../../users/domain/exceptions/user.exceptions';

describe('LoginUseCase', () => {
  let loginUseCase: LoginUseCase;
  let getUserByEmail: jest.Mocked<GetUserByEmailUseCase>;
  let passwordHasher: jest.Mocked<IPasswordHasher>;
  let tokenProvider: jest.Mocked<ITokenProvider>;

  const mockUser = User.reconstitute({
    id: 'user-uuid',
    email: Email.create('test@example.com'),
    passwordHash: 'hashed-password',
    name: 'Test User',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const mockTokenPair = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };

  beforeEach(() => {
    getUserByEmail = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<GetUserByEmailUseCase>;

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
      getUserByEmail,
      passwordHasher,
      tokenProvider,
    );
  });

  it('should return tokens when credentials are valid', async () => {
    getUserByEmail.execute.mockResolvedValue(mockUser);
    passwordHasher.compare.mockResolvedValue(true);
    tokenProvider.generateTokens.mockResolvedValue(mockTokenPair);

    const result = await loginUseCase.execute({
      email: 'test@example.com',
      password: 'correct-password',
    });

    expect(result).toEqual(mockTokenPair);
    expect(getUserByEmail.execute).toHaveBeenCalledWith({
      email: 'test@example.com',
    });
    expect(passwordHasher.compare).toHaveBeenCalledWith(
      'correct-password',
      'hashed-password',
    );
    expect(tokenProvider.generateTokens).toHaveBeenCalledWith({
      sub: 'user-uuid',
      email: 'test@example.com',
    });
  });

  it('should throw InvalidCredentialsException when password is wrong', async () => {
    getUserByEmail.execute.mockResolvedValue(mockUser);
    passwordHasher.compare.mockResolvedValue(false);

    await expect(
      loginUseCase.execute({
        email: 'test@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toThrow(InvalidCredentialsException);

    expect(tokenProvider.generateTokens).not.toHaveBeenCalled();
  });

  it('should propagate UserNotFoundException when user does not exist', async () => {
    getUserByEmail.execute.mockRejectedValue(
      new UserNotFoundException('test@example.com'),
    );

    await expect(
      loginUseCase.execute({
        email: 'test@example.com',
        password: 'any-password',
      }),
    ).rejects.toThrow(UserNotFoundException);
  });
});
