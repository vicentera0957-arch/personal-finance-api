import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtTokenProvider } from './jwt-token-provider';

describe('JwtTokenProvider', () => {
  let jwtService: jest.Mocked<JwtService>;
  let configService: ConfigService;
  let provider: JwtTokenProvider;

  beforeEach(() => {
    jwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;

    const configMap: Record<string, string> = {
      JWT_SECRET: 'access-secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        const val = configMap[key];
        if (val === undefined) throw new Error(`Missing config ${key}`);
        return val;
      }),
    } as unknown as ConfigService;

    provider = new JwtTokenProvider(jwtService, configService);
  });

  describe('generateAccessToken', () => {
    it('firma con access secret y expiración correcta', async () => {
      jwtService.signAsync.mockResolvedValue('access-token');

      const result = await provider.generateAccessToken({
        sub: 'user-1',
        email: 'a@b.cl',
      });

      expect(result).toBe('access-token');
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'a@b.cl' },
        { secret: 'access-secret', expiresIn: '15m' },
      );
    });
  });

  describe('generateRefreshToken', () => {
    it('firma con refresh secret e incluye jti en el payload', async () => {
      jwtService.signAsync.mockResolvedValue('refresh-token');

      const result = await provider.generateRefreshToken({
        sub: 'user-1',
        email: 'a@b.cl',
        jti: 'some-uuid',
      });

      expect(result).toBe('refresh-token');
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'a@b.cl', jti: 'some-uuid' },
        { secret: 'refresh-secret', expiresIn: '7d' },
      );
    });
  });

  describe('getRefreshTokenExpiresAt', () => {
    it('devuelve una fecha ~7 días en el futuro', () => {
      const before = Date.now();
      const result = provider.getRefreshTokenExpiresAt();
      const after = Date.now();

      const sevenDaysMs = 7 * 86_400_000;
      expect(result.getTime()).toBeGreaterThanOrEqual(
        before + sevenDaysMs - 100,
      );
      expect(result.getTime()).toBeLessThanOrEqual(after + sevenDaysMs + 100);
    });
  });

  describe('verifyAccessToken', () => {
    it('should return the decoded payload when signature is valid', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        email: 'a@b.cl',
      });

      const result = await provider.verifyAccessToken('token');

      expect(result).toEqual({ sub: 'user-1', email: 'a@b.cl' });
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('token', {
        secret: 'access-secret',
      });
    });

    it('should throw UnauthorizedException when JwtService throws', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

      await expect(provider.verifyAccessToken('bad')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('verifyRefreshToken', () => {
    it('devuelve payload con jti cuando el token es válido', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        email: 'a@b.cl',
        jti: 'some-uuid',
      });

      const result = await provider.verifyRefreshToken('r-token');

      expect(result).toEqual({
        sub: 'user-1',
        email: 'a@b.cl',
        jti: 'some-uuid',
      });
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('r-token', {
        secret: 'refresh-secret',
      });
    });

    it('should throw UnauthorizedException when JwtService throws', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

      await expect(provider.verifyRefreshToken('bad')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
