import { Injectable } from '@nestjs/common';
import { GetUserByEmailUseCase } from '../../../users/application/use-cases/get-user-by-email.use-case'; // auth depends on users — intentional. auth is always above users in the hierarchy.
import { IPasswordHasher } from '../../domain/ports/password-hasher.port';
import {
  ITokenProvider,
  TokenPair,
} from '../../domain/ports/token-provider.port';
import { InvalidCredentialsException } from '../../domain/exceptions/auth.exceptions';

export interface LoginDto {
  email: string;
  password: string;
}

@Injectable()
export class LoginUseCase {
  constructor(
    private readonly getUserByEmail: GetUserByEmailUseCase,
    private readonly passwordHasher: IPasswordHasher,
    private readonly tokenProvider: ITokenProvider,
  ) {}

  async execute(dto: LoginDto): Promise<TokenPair> {
    const user = await this.getUserByEmail.execute({ email: dto.email });

    const isValid = await this.passwordHasher.compare(
      dto.password,
      user.getPasswordHash(),
    );
    if (!isValid) {
      throw new InvalidCredentialsException();
    }

    return this.tokenProvider.generateTokens({
      sub: user.id,
      email: user.email.getValue(),
    });
  }
}
