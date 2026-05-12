import { Global, Module } from '@nestjs/common';
import { ICacheStore } from '../../domain/cache/cache-store.port';
import { RedisCacheStore } from './redis-cache-store';

@Global()
@Module({
  providers: [
    RedisCacheStore,
    { provide: ICacheStore, useExisting: RedisCacheStore },
  ],
  exports: [ICacheStore],
})
export class CacheModule {}
