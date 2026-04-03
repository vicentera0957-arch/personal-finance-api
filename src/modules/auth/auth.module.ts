import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { UsersModule } from '../users/users.module';

// Use cases
import { LoginUseCase } from './application/use-cases/login.use-case';
import { RegisterUseCase } from './application/use-cases/register.use-case';
import { RefreshTokenUseCase } from './application/use-cases/refresh-token.use-case';

// Ports → Adapters
import { IPasswordHasher } from './domain/ports/password-hasher.port';
import { ITokenProvider } from './domain/ports/token-provider.port';
import { BcryptPasswordHasher } from './infrastructure/adapters/bcrypt-password-hasher';
import { JwtTokenProvider } from './infrastructure/adapters/jwt-token-provider';

// Guards & Strategy
import { JwtStrategy } from './infrastructure/guards/jwt.strategy';
import { JwtAuthGuard } from './infrastructure/guards/jwt-auth.guard';

// Controller
import { AuthController } from './infrastructure/http/auth-controller/auth.controller';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    // Use cases
    LoginUseCase,
    RegisterUseCase,
    RefreshTokenUseCase,

    // Port → Adapter bindings
    { provide: IPasswordHasher, useClass: BcryptPasswordHasher },
    { provide: ITokenProvider, useClass: JwtTokenProvider },

    // Passport
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
