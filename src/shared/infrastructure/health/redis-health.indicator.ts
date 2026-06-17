import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { ICacheStore } from '../../domain/cache/cache-store.port';

/**
 * Health indicator de Redis para la readiness probe.
 *
 * Redis es una DEPENDENCIA DURA del sistema: el ThrottlerGuard global usa Redis
 * como storage y su increment() rechaza si Redis no responde → sin Redis, cada
 * request muere con 500. Por eso lo metemos en /ready: si Redis no responde,
 * /ready devuelve 503 y el orquestador deja de routear tráfico (en vez de
 * mandar requests que van a fallar igual).
 *
 * Reutiliza la conexión del cache store (ICacheStore.ping()) — no abre una
 * conexión nueva sólo para el health check.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly cache: ICacheStore,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.cache.ping();
      return indicator.up();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unreachable';
      // down() produce el resultado con status 'down'; HealthCheckService lo
      // agrega y responde 503 cuando algún indicador está down.
      return indicator.down({ message });
    }
  }
}
