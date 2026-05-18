import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ICacheStore } from '../../domain/cache/cache-store.port';

@Injectable()
export class RedisCacheStore
  extends ICacheStore
  implements OnModuleInit, OnModuleDestroy
{
  private readonly client: Redis;
  private readonly keyPrefix: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.keyPrefix = config.get<string>('REDIS_KEY_PREFIX', 'pf:');
    this.client = new Redis({
      host: config.get<string>('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      // Sin auto-reconnect infinito en test — falla rápido si Redis no está.
      maxRetriesPerRequest: 3,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.ping();
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }

  private prefixed(key: string): string {
    return this.keyPrefix + key;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(this.prefixed(key));
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(
      this.prefixed(key),
      JSON.stringify(value),
      'EX',
      ttlSeconds,
    );
  }

  async del(key: string): Promise<void> {
    await this.client.del(this.prefixed(key));
  }

  async delByPrefix(prefix: string): Promise<void> {
    const pattern = this.prefixed(prefix) + '*';
    const stream = this.client.scanStream({ match: pattern, count: 100 });

    for await (const batch of stream as AsyncIterable<string[]>) {
      if (batch.length > 0) {
        await this.client.del(...batch);
      }
    }
  }
}
