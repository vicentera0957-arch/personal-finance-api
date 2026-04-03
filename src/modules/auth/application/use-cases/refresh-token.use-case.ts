import { Injectable } from '@nestjs/common';
import { ITokenProvider, TokenPair } from '../../domain/ports/token-provider.port';

@Injectable()
export class RefreshTokenUseCase {
  constructor(private readonly tokenProvider: ITokenProvider) {}

  async execute(refreshToken: string): Promise<TokenPair> {
    const payload = await this.tokenProvider.verifyRefreshToken(refreshToken);

    return this.tokenProvider.generateTokens({
      sub: payload.sub,
      email: payload.email,
    });
  }
}
