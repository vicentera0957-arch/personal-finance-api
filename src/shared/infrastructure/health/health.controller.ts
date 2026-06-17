import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorFunction,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../../../modules/auth/infrastructure/decorators/public.decorator';
import { RedisHealthIndicator } from './redis-health.indicator';

/**
 * Readiness probe — distinta de la liveness `/health` (en AppController).
 *
 *   - /health (liveness):  ¿el proceso vive? → el orquestador REINICIA si falla.
 *   - /ready  (readiness): ¿puede atender tráfico? → el orquestador deja de
 *                          ROUTEAR si falla, sin reiniciar (un blip de DB no
 *                          debe matar el pod).
 *
 * Pública (sin JWT) y excluida del prefix `api/v1` (ver main.ts).
 */
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary:
      'Readiness probe — 200 si DB y Redis responden, 503 si alguno falla.',
  })
  readiness(): Promise<HealthCheckResult> {
    const checks: HealthIndicatorFunction[] = [
      () => this.db.pingCheck('database', { timeout: 3000 }),
      // Redis es dependencia dura: el throttler global lo necesita. Si no
      // responde, /ready = 503 y el orquestador deja de routear.
      () => this.redis.isHealthy('redis'),
    ];
    return this.health.check(checks);
  }
}
