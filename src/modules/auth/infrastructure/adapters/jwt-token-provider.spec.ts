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

    configService = {
      getOrThrow: jest.fn((key: string) =>
        key === 'JWT_SECRET' ? 'access-secret' : 'refresh-secret',
      ),
    } as unknown as ConfigService;

    provider = new JwtTokenProvider(jwtService, configService);
  });

  describe('generateTokens', () => {
    it('should sign access and refresh tokens with their respective secrets and expirations', async () => {
      jwtService.signAsync
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token');

      const result = await provider.generateTokens({
        sub: 'user-1',
        email: 'a@b.cl',
      });

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'a@b.cl' },
        { secret: 'access-secret', expiresIn: '15m' },
      );
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: 'user-1', email: 'a@b.cl' },
        { secret: 'refresh-secret', expiresIn: '7d' },
      );
    });
  });

  describe('verifyAccessToken', () => {
    it('should return the decoded payload when signature is valid', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', email: 'a@b.cl' });

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
    it('should return the decoded payload when valid', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', email: 'a@b.cl' });

      const result = await provider.verifyRefreshToken('r-token');

      expect(result).toEqual({ sub: 'user-1', email: 'a@b.cl' });
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
