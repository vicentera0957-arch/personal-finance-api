import { Module, Scope } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module';

// Use cases
import { LoginUseCase } from './application/use-cases/login.use-case';
import { RegisterUseCase } from './application/use-cases/register.use-case';
import { RefreshTokenUseCase } from './application/use-cases/refresh-token.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';

// Schedulers
import { CleanupExpiredTokensScheduler } from './application/schedulers/cleanup-expired-tokens.scheduler';

// Domain ports
import { IPasswordHasher } from './domain/ports/password-hasher.port';
import { ITokenProvider } from './domain/ports/token-provider.port';
import { IRefreshTokenRepository } from './domain/repository/refresh-token.repository';
import { IAuthUnitOfWork } from './domain/IAuthUnitOfWork';

// Adapters
import { BcryptPasswordHasher } from './infrastructure/adapters/bcrypt-password-hasher';
import { JwtTokenProvider } from './infrastructure/adapters/jwt-token-provider';

// Persistence
import { RefreshTokenOrmEntity } from './infrastructure/persistence/refresh-token.orm.entity';
import { RefreshTokenMapper } from './infrastructure/persistence/refresh-token.mapper';
import { RefreshTokenRepositoryImpl } from './infrastructure/persistence/refresh-token.repository.impl';
import { AuthUnitOfWorkImpl } from './infrastructure/persistence/auth-unit-of-work.impl';

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
    TypeOrmModule.forFeature([RefreshTokenOrmEntity]),
  ],
  controllers: [AuthController],
  providers: [
    // Use cases
    LoginUseCase,
    RegisterUseCase,
    RefreshTokenUseCase,
    LogoutUseCase,

    // Scheduler
    CleanupExpiredTokensScheduler,

    // Port → Adapter bindings
    { provide: IPasswordHasher, useClass: BcryptPasswordHasher },
    { provide: ITokenProvider, useClass: JwtTokenProvider },
    { provide: IRefreshTokenRepository, useClass: RefreshTokenRepositoryImpl },

    // Refresh token persistence helpers
    RefreshTokenMapper,

    // UoW — REQUEST scope para que el mismo QueryRunner se use en toda la operación
    {
      provide: AuthUnitOfWorkImpl,
      useClass: AuthUnitOfWorkImpl,
      scope: Scope.REQUEST,
    },
    { provide: IAuthUnitOfWork, useExisting: AuthUnitOfWorkImpl },

    // Passport
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
