import { RegisterUseCase } from './register.use-case';
import { CreateUserUseCase } from '../../../users/application/use-cases/create-user.use-case';
import { IPasswordHasher } from '../../domain/ports/password-hasher.port';
import { ITokenProvider } from '../../domain/ports/token-provider.port';
import { User } from '../../../users/domain/entities/user.entity';
import { Email } from '../../../users/domain/value-objects/email.vo';
import { UserAlreadyExistsException } from '../../../users/domain/exceptions/user.exceptions';

describe('RegisterUseCase', () => {
  let registerUseCase: RegisterUseCase;
  let createUser: jest.Mocked<CreateUserUseCase>;
  let passwordHasher: jest.Mocked<IPasswordHasher>;
  let tokenProvider: jest.Mocked<ITokenProvider>;

  const mockUser = User.reconstitute({
    id: 'user-uuid',
    email: Email.create('new@example.com'),
    passwordHash: 'hashed-password',
    name: 'New User',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const mockTokenPair = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };

  beforeEach(() => {
    createUser = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<CreateUserUseCase>;

    passwordHasher = {
      hash: jest.fn().mockResolvedValue('hashed-password'),
      compare: jest.fn(),
    };

    tokenProvider = {
      generateTokens: jest.fn(),
      verifyAccessToken: jest.fn(),
      verifyRefreshToken: jest.fn(),
    };

    registerUseCase = new RegisterUseCase(createUser, passwordHasher, tokenProvider);
  });

  it('should create user and return tokens', async () => {
    createUser.execute.mockResolvedValue(mockUser);
    tokenProvider.generateTokens.mockResolvedValue(mockTokenPair);

    const result = await registerUseCase.execute({
      name: 'New User',
      email: 'new@example.com',
      password: 'secure-password',
    });

    expect(result).toEqual(mockTokenPair);
    expect(passwordHasher.hash).toHaveBeenCalledWith('secure-password');
    expect(createUser.execute).toHaveBeenCalledWith({
      name: 'New User',
      email: 'new@example.com',
      passwordHash: 'hashed-password',
    });
    expect(tokenProvider.generateTokens).toHaveBeenCalledWith({
      sub: 'user-uuid',
      email: 'new@example.com',
    });
  });

  it('should propagate UserAlreadyExistsException', async () => {
    createUser.execute.mockRejectedValue(
      new UserAlreadyExistsException('new@example.com'),
    );

    await expect(
      registerUseCase.execute({
        name: 'New User',
        email: 'new@example.com',
        password: 'secure-password',
      }),
    ).rejects.toThrow(UserAlreadyExistsException);
  });
});
