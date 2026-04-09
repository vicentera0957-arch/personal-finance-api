import { Injectable } from '@nestjs/common';
import { CreateUserUseCase } from '../../../users/application/use-cases/create-user.use-case';
import { IPasswordHasher } from '../../domain/ports/password-hasher.port';
import {
  ITokenProvider,
  TokenPair,
} from '../../domain/ports/token-provider.port';

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
  ) {}

  async execute(dto: RegisterDto): Promise<TokenPair> {
    const passwordHash = await this.passwordHasher.hash(dto.password);

    const user = await this.createUser.execute({
      name: dto.name,
      email: dto.email,
      passwordHash,
    });

    return this.tokenProvider.generateTokens({
      sub: user.id,
      email: user.email.getValue(),
    });
  }
}
