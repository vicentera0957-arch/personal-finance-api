import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { CreateUserUseCase } from '../../../users/application/use-cases/create-user.use-case';
import { IPasswordHasher } from '../../domain/ports/password-hasher.port';
import {
  ITokenProvider,
  TokenPair,
} from '../../domain/ports/token-provider.port';
import { IRefreshTokenRepository } from '../../domain/repository/refresh-token.repository';
import { RefreshToken } from '../../domain/entities/refresh-token.entity';
import { sha256 } from '../utils/token-hash.util';

export interface RegisterDto {
  name: string;
  email: string;
  password: string;
}

@Injectable()
export class RegisterUseCase {
  constructor(
    private readonly createUser: CreateUserUseCase,
    private readonly passwordHasher: IPasswordHasher,
    private readonly tokenProvider: ITokenProvider,
    private readonly refreshTokenRepo: IRefreshTokenRepository,
  ) {}

  async execute(dto: RegisterDto): Promise<TokenPair> {
    const passwordHash = await this.passwordHasher.hash(dto.password);

    const user = await this.createUser.execute({
      name: dto.name,
      email: dto.email,
      passwordHash,
    });

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
