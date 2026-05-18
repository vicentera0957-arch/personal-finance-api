import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ITokenProvider,
  RefreshTokenPayload,
} from '../../domain/ports/token-provider.port';

interface AccessPayload {
  sub: string;
  email: string;
}

interface RefreshPayload extends AccessPayload {
  jti: string;
}

/**
 * Parsea strings de duración tipo "7d", "15m", "24h", "30s" a milisegundos.
 * Suficiente para los valores típicos de JWT_REFRESH_EXPIRES_IN.
 */
function parseDurationMs(duration: string): number {
  const units: Record<string, number> = {
    d: 86_400_000,
    h: 3_600_000,
    m: 60_000,
    s: 1_000,
  };
  const match = /^(\d+)([dhms])$/.exec(duration);
  if (!match)
    throw new Error(`No se puede parsear duración JWT: "${duration}"`);
  return parseInt(match[1], 10) * units[match[2]];
}

/**
 * Adapter que implementa ITokenProvider usando @nestjs/jwt (jsonwebtoken).
 *
 * - Dos secrets separados (access vs refresh): si filtra uno, el otro queda intacto.
 * - Los refresh tokens llevan un claim `jti` (UUID) — es la PK en refresh_tokens.
 * - verifyAsync no bloquea el event loop (seguro para RS256 asimétrico en el futuro).
 */
@Injectable()
export class JwtTokenProvider extends ITokenProvider {
  private readonly jwtSecret: string;
  private readonly jwtRefreshSecret: string;
  private readonly accessExpiresIn: string;
  private readonly refreshExpiresIn: string;
  private readonly refreshExpiresInMs: number;

  constructor(
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    super();
    this.jwtSecret = configService.getOrThrow<string>('JWT_SECRET');
    this.jwtRefreshSecret =
      configService.getOrThrow<string>('JWT_REFRESH_SECRET');
    this.accessExpiresIn = configService.getOrThrow<string>(
      'JWT_ACCESS_EXPIRES_IN',
    );
    this.refreshExpiresIn = configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );
    this.refreshExpiresInMs = parseDurationMs(this.refreshExpiresIn);
  }

  async generateAccessToken(payload: AccessPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.jwtSecret,
      expiresIn: this.accessExpiresIn as unknown as number,
    });
  }

  async generateRefreshToken(payload: RefreshPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.jwtRefreshSecret,
      expiresIn: this.refreshExpiresIn as unknown as number,
    });
  }

  getRefreshTokenExpiresAt(): Date {
    return new Date(Date.now() + this.refreshExpiresInMs);
  }

  async verifyAccessToken(token: string): Promise<AccessPayload> {
    try {
      return await this.jwtService.verifyAsync<AccessPayload>(token, {
        secret: this.jwtSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<RefreshPayload>(token, {
        secret: this.jwtRefreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
