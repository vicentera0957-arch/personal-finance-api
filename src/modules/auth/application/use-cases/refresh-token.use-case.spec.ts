import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenUseCase } from './refresh-token.use-case';
import { ITokenProvider } from '../../domain/ports/token-provider.port';

describe('RefreshTokenUseCase', () => {
  let refreshTokenUseCase: RefreshTokenUseCase;
  let tokenProvider: jest.Mocked<ITokenProvider>;

  const mockTokenPair = {
    accessToken: 'new-access-token',
    refreshToken: 'new-refresh-token',
  };

  beforeEach(() => {
    tokenProvider = {
      generateTokens: jest.fn(),
      verifyAccessToken: jest.fn(),
      verifyRefreshToken: jest.fn(),
    };

    refreshTokenUseCase = new RefreshTokenUseCase(tokenProvider);
  });

  it('should verify old refresh token and return new token pair', async () => {
    tokenProvider.verifyRefreshToken.mockResolvedValue({
      sub: 'user-uuid',
      email: 'test@example.com',
    });
    tokenProvider.generateTokens.mockResolvedValue(mockTokenPair);

    const result = await refreshTokenUseCase.execute('old-refresh-token');

    expect(result).toEqual(mockTokenPair);
    expect(tokenProvider.verifyRefreshToken).toHaveBeenCalledWith(
      'old-refresh-token',
    );
    expect(tokenProvider.generateTokens).toHaveBeenCalledWith({
      sub: 'user-uuid',
      email: 'test@example.com',
    });
  });

  it('should throw when refresh token is invalid', async () => {
    tokenProvider.verifyRefreshToken.mockRejectedValue(
      new UnauthorizedException('Invalid or expired refresh token'),
    );

    await expect(refreshTokenUseCase.execute('invalid-token')).rejects.toThrow(
      UnauthorizedException,
    );

    expect(tokenProvider.generateTokens).not.toHaveBeenCalled();
  });
});
