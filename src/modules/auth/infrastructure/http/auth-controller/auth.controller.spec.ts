import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { LoginUseCase } from '../../../application/use-cases/login.use-case';
import { RegisterUseCase } from '../../../application/use-cases/register.use-case';
import { RefreshTokenUseCase } from '../../../application/use-cases/refresh-token.use-case';
import { LogoutUseCase } from '../../../application/use-cases/logout.use-case';
import {
  InvalidCredentialsException,
  InvalidRefreshTokenException,
  RefreshTokenExpiredException,
  RefreshTokenReplayDetectedException,
} from '../../../domain/exceptions/auth.exceptions';
import {
  UserAlreadyExistsException,
  UserNotFoundException,
} from '../../../../users/domain/exceptions/user.exceptions';

describe('AuthController', () => {
  let controller: AuthController;
  let loginUseCase: jest.Mocked<LoginUseCase>;
  let registerUseCase: jest.Mocked<RegisterUseCase>;
  let refreshTokenUseCase: jest.Mocked<RefreshTokenUseCase>;
  let logoutUseCase: jest.Mocked<LogoutUseCase>;

  const tokens = { accessToken: 'access', refreshToken: 'refresh' };

  beforeEach(() => {
    loginUseCase = { execute: jest.fn() } as unknown as jest.Mocked<LoginUseCase>;
    registerUseCase = { execute: jest.fn() } as unknown as jest.Mocked<RegisterUseCase>;
    refreshTokenUseCase = { execute: jest.fn() } as unknown as jest.Mocked<RefreshTokenUseCase>;
    logoutUseCase = { execute: jest.fn() } as unknown as jest.Mocked<LogoutUseCase>;

    controller = new AuthController(
      loginUseCase,
      registerUseCase,
      refreshTokenUseCase,
      logoutUseCase,
    );
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

    it('maps InvalidRefreshTokenException to 401', async () => {
      refreshTokenUseCase.execute.mockRejectedValue(new InvalidRefreshTokenException());

      await expect(
        controller.refresh({ refreshToken: 'bad' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('maps RefreshTokenExpiredException to 401', async () => {
      refreshTokenUseCase.execute.mockRejectedValue(new RefreshTokenExpiredException());

      await expect(
        controller.refresh({ refreshToken: 'expired' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('maps RefreshTokenReplayDetectedException to 401', async () => {
      refreshTokenUseCase.execute.mockRejectedValue(new RefreshTokenReplayDetectedException());

      await expect(
        controller.refresh({ refreshToken: 'replayed' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('propagates unexpected errors (does NOT swallow as 401)', async () => {
      refreshTokenUseCase.execute.mockRejectedValue(new Error('db connection lost'));

      await expect(
        controller.refresh({ refreshToken: 'bad' }),
      ).rejects.toThrow(Error);
    });
  });

  describe('logout', () => {
    it('returns void (204) on successful logout', async () => {
      logoutUseCase.execute.mockResolvedValue(undefined);

      await expect(
        controller.logout({ refreshToken: 'rt' }),
      ).resolves.toBeUndefined();
      expect(logoutUseCase.execute).toHaveBeenCalledWith('rt');
    });

    it('maps InvalidRefreshTokenException to 401', async () => {
      logoutUseCase.execute.mockRejectedValue(new InvalidRefreshTokenException());

      await expect(
        controller.logout({ refreshToken: 'bad' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
