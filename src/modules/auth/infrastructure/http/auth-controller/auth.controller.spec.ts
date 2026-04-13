import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { LoginUseCase } from '../../../application/use-cases/login.use-case';
import { RegisterUseCase } from '../../../application/use-cases/register.use-case';
import { RefreshTokenUseCase } from '../../../application/use-cases/refresh-token.use-case';
import { InvalidCredentialsException } from '../../../domain/exceptions/auth.exceptions';
import {
  UserAlreadyExistsException,
  UserNotFoundException,
} from '../../../../users/domain/exceptions/user.exceptions';

describe('AuthController', () => {
  let controller: AuthController;
  let loginUseCase: jest.Mocked<LoginUseCase>;
  let registerUseCase: jest.Mocked<RegisterUseCase>;
  let refreshTokenUseCase: jest.Mocked<RefreshTokenUseCase>;

  const tokens = { accessToken: 'access', refreshToken: 'refresh' };

  beforeEach(() => {
    loginUseCase = { execute: jest.fn() } as unknown as jest.Mocked<LoginUseCase>;
    registerUseCase = { execute: jest.fn() } as unknown as jest.Mocked<RegisterUseCase>;
    refreshTokenUseCase = { execute: jest.fn() } as unknown as jest.Mocked<RefreshTokenUseCase>;

    controller = new AuthController(loginUseCase, registerUseCase, refreshTokenUseCase);
  });

  describe('login', () => {
    it('should return token pair on valid credentials', async () => {
      loginUseCase.execute.mockResolvedValue(tokens);

      const result = await controller.login({
        email: 'a@b.cl',
        password: 'pw',
      });

      expect(result).toEqual(tokens);
      expect(loginUseCase.execute).toHaveBeenCalledWith({
        email: 'a@b.cl',
        password: 'pw',
      });
    });

    it('should map InvalidCredentialsException to 401', async () => {
      loginUseCase.execute.mockRejectedValue(new InvalidCredentialsException());

      await expect(
        controller.login({ email: 'a@b.cl', password: 'pw' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should map UserNotFoundException to 401 (not 404, to avoid user enumeration)', async () => {
      loginUseCase.execute.mockRejectedValue(new UserNotFoundException('a@b.cl'));

      await expect(
        controller.login({ email: 'a@b.cl', password: 'pw' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('register', () => {
    it('should return token pair on successful registration', async () => {
      registerUseCase.execute.mockResolvedValue(tokens);

      const result = await controller.register({
        name: 'New',
        email: 'new@b.cl',
        password: 'pw',
      });

      expect(result).toEqual(tokens);
      expect(registerUseCase.execute).toHaveBeenCalledWith({
        name: 'New',
        email: 'new@b.cl',
        password: 'pw',
      });
    });

    it('should map UserAlreadyExistsException to 409', async () => {
      registerUseCase.execute.mockRejectedValue(
        new UserAlreadyExistsException('new@b.cl'),
      );

      await expect(
        controller.register({ name: 'New', email: 'new@b.cl', password: 'pw' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('refresh', () => {
    it('should return new token pair for valid refresh token', async () => {
      refreshTokenUseCase.execute.mockResolvedValue(tokens);

      const result = await controller.refresh({ refreshToken: 'old-refresh' });

      expect(result).toEqual(tokens);
      expect(refreshTokenUseCase.execute).toHaveBeenCalledWith('old-refresh');
    });

    it('should map any error to 401', async () => {
      refreshTokenUseCase.execute.mockRejectedValue(new Error('invalid'));

      await expect(
        controller.refresh({ refreshToken: 'bad' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
