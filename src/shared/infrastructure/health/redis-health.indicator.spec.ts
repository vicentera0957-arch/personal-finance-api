import { HealthIndicatorService } from '@nestjs/terminus';
import { ICacheStore } from '../../domain/cache/cache-store.port';
import { RedisHealthIndicator } from './redis-health.indicator';

describe('RedisHealthIndicator', () => {
  let cache: jest.Mocked<Pick<ICacheStore, 'ping'>>;
  let indicator: RedisHealthIndicator;

  beforeEach(() => {
    cache = { ping: jest.fn() };
    indicator = new RedisHealthIndicator(
      new HealthIndicatorService(),
      cache as unknown as ICacheStore,
    );
  });

  it('reporta UP cuando Redis responde al ping', async () => {
    cache.ping.mockResolvedValue(undefined);

    const result = await indicator.isHealthy('redis');

    expect(result.redis.status).toBe('up');
    expect(cache.ping).toHaveBeenCalledTimes(1);
  });

  it('reporta DOWN (no lanza) cuando Redis no responde, con el mensaje de error', async () => {
    cache.ping.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await indicator.isHealthy('redis');

    expect(result.redis.status).toBe('down');
    expect(result.redis.message).toContain('ECONNREFUSED');
  });
});
