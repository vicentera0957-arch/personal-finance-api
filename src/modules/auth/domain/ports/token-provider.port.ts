export interface TokenPair {
  //estructura de datos que representa el par de tokens (access y refresh) que se emite al usuario después de autenticarse o refrescar tokens.
  accessToken: string;
  refreshToken: string;
}

export interface RefreshTokenPayload {
  //ED que representa el payload que se espera encontrar en un refresh token JWT después de verificar su firma.
  sub: string;
  email: string;
  /** jti — ID único del token, usado como PK en refresh_tokens. */
  jti: string;
}

export abstract class ITokenProvider {
  abstract generateAccessToken(payload: {
    sub: string;
    email: string;
  }): Promise<string>;

  abstract generateRefreshToken(payload: {
    sub: string;
    email: string;
    jti: string;
  }): Promise<string>;

  abstract verifyAccessToken(
    token: string,
  ): Promise<{ sub: string; email: string }>;

  abstract verifyRefreshToken(token: string): Promise<RefreshTokenPayload>;

  /** Devuelve la fecha de expiración que tendrá el próximo refresh token emitido. */
  abstract getRefreshTokenExpiresAt(): Date;
}
