import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { GetUserByEmailUseCase } from '../../../users/application/use-cases/get-user-by-email.use-case';
import { UserNotFoundException } from '../../../users/domain/exceptions/user.exceptions';
import { IPasswordHasher } from '../../domain/ports/password-hasher.port';
import {
  ITokenProvider,
  TokenPair,
} from '../../domain/ports/token-provider.port';
import { IRefreshTokenRepository } from '../../domain/repository/refresh-token.repository';
import { RefreshToken } from '../../domain/entities/refresh-token.entity';
import { InvalidCredentialsException } from '../../domain/exceptions/auth.exceptions';
import { sha256 } from '../utils/token-hash.util';

export interface LoginDto {
  email: string;
  password: string;
}

/**
 * Hash bcrypt dummy generado con SALT_ROUNDS=10 para la string 'invalid-password-never-matches'.
 * Cuando el usuario no existe, igualmente ejecutamos bcrypt.compare contra este hash
 * para que el tiempo de respuesta no filtre si el email existe o no (timing attack).
 *
 * Regenerable con: node -e "require('bcrypt').hash('x', 10).then(console.log)"
 */
const BCRYPT_DUMMY_HASH =
  '$2b$10$CwTycUXWue0Thq9StjUM0uJ8eVbZp3qKOiDFYbqe8LbJv8pWqkwfe';

@Injectable()
export class LoginUseCase {
  constructor(
    private readonly getUserByEmail: GetUserByEmailUseCase,
    private readonly passwordHasher: IPasswordHasher,
    private readonly tokenProvider: ITokenProvider,
    private readonly refreshTokenRepo: IRefreshTokenRepository,
  ) {}

  async execute(dto: LoginDto): Promise<TokenPair> {
    // Flow timing-safe:
    //   1. Siempre hacemos bcrypt.compare (caro ~100ms), existe o no el user.
    //   2. Una sola excepción genérica — no revelamos "user not found" vs "bad password".
    // Sin esto, un atacante mide latencias y enumera emails válidos.
    let user: Awaited<ReturnType<typeof this.getUserByEmail.execute>> | null =
      null;
    try {
      user = await this.getUserByEmail.execute({ email: dto.email });
    } catch (err) {
      if (!(err instanceof UserNotFoundException)) throw err;
    }

    const hashToCompare = user ? user.getPasswordHash() : BCRYPT_DUMMY_HASH;
    const isValid = await this.passwordHasher.compare(
      dto.password,
      hashToCompare,
    );

    if (!user || !isValid) {
      throw new InvalidCredentialsException();
    }

    const email = user.email.getValue();
    const jti = uuidv4();
    const familyId = uuidv4();

    const [accessToken, refreshToken] = await Promise.all([
      this.tokenProvider.generateAccessToken({ sub: user.id, email }),
      this.tokenProvider.generateRefreshToken({ sub: user.id, email, jti }),
    ]);

    const tokenEntity = RefreshToken.create({
      id: jti,
      userId: user.id,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: this.tokenProvider.getRefreshTokenExpiresAt(),
    });

    await this.refreshTokenRepo.save(tokenEntity);

    return { accessToken, refreshToken };
  }
}
