import { Injectable } from '@nestjs/common';
import { CreateUserUseCase } from '../../../users/application/use-cases/create-user.use-case';
import { ITokenProvider, TokenPair } from '../../domain/ports/token-provider.port';

export interface RegisterDto {
  name: string;
  email: string;
  password: string;
}

@Injectable()
export class RegisterUseCase {
  constructor(
    private readonly createUser: CreateUserUseCase,
    private readonly tokenProvider: ITokenProvider,
  ) {}

  async execute(dto: RegisterDto): Promise<TokenPair> {
    const user = await this.createUser.execute({
      name: dto.name,
      email: dto.email,
      password: dto.password,
    });

    return this.tokenProvider.generateTokens({
      sub: user.id,
      email: user.email.getValue(),
    });
  }
}
