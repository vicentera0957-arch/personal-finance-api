import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis-health.indicator';

/**
 * Encapsula la readiness probe. TerminusModule provee HealthCheckService y
 * TypeOrmHealthIndicator (usa la conexión TypeORM por defecto del AppModule).
 * RedisHealthIndicator chequea Redis (dependencia dura del throttler) vía el
 * ICacheStore global.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
