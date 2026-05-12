import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './modules/users/users.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/infrastructure/guards/jwt-auth.guard';
import { envValidationSchema } from './config/env.validation';
import { CacheModule } from './shared/infrastructure/cache/cache.module';

/**
 * Módulo raíz — cablea:
 *   - ConfigModule global con validación Joi (ver env.validation.ts).
 *   - Pino logger global con correlation ID (x-request-id) por request.
 *     → permite trazar un request a través de todos sus logs.
 *   - TypeORM con synchronize CONDICIONAL: true en dev, false en prod (usar migrations).
 *   - Throttler global (rate limit por IP).
 *   - JwtAuthGuard global via APP_GUARD — todas las rutas protegidas salvo @Public().
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL', 'info'),
          // En dev: formato bonito y colorido. En prod: JSON estructurado
          // que va a Grafana Loki / Datadog / CloudWatch con parsing automático.
          transport:
            config.get<string>('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          // Correlation ID: o lo trae el cliente o generamos uno.
          // Clave para debuguear un request en logs distribuidos.
          genReqId: (req) =>
            (req.headers['x-request-id'] as string) ?? randomUUID(),
          // No logear secretos ni PII en producción.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.refreshToken',
              '*.passwordHash',
            ],
            censor: '[REDACTED]',
          },
        },
      }),
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('THROTTLE_TTL', 60_000),
            limit: config.get<number>('THROTTLE_LIMIT', 100),
          },
          // Throttler específico 'auth' — usar @Throttle({ auth: { ... } }) en /auth/*
          {
            name: 'auth',
            ttl: config.get<number>('THROTTLE_AUTH_TTL', 60_000),
            limit: config.get<number>('THROTTLE_AUTH_LIMIT', 5),
          },
        ],
      }),
    }),

    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USER'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        autoLoadEntities: true,
        // synchronize sólo en desarrollo. En prod hay que usar migraciones (ver data-source.ts).
        synchronize:
          config.get<string>('NODE_ENV') !== 'production' &&
          config.get<boolean>('DB_SYNCHRONIZE', false),
        logging: config.get<boolean>('DB_LOGGING', false),
      }),
    }),

    CacheModule,
    AuthModule,
    UsersModule,
    AccountsModule,
    CategoriesModule,
    BudgetsModule,
    TransactionsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Guard global: todas las rutas requieren JWT salvo las marcadas @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Rate limiting global
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
