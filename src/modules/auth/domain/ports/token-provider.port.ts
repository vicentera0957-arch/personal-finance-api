export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export abstract class ITokenProvider {
  abstract generateTokens(payload: {
    sub: string;
    email: string;
  }): Promise<TokenPair>;
  abstract verifyAccessToken(
    token: string,
  ): Promise<{ sub: string; email: string }>;
  abstract verifyRefreshToken(
    token: string,
  ): Promise<{ sub: string; email: string }>;
}
