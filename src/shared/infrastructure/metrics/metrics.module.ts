import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';

/**
 * Prometheus metrics. Provides MetricsService (the registry + histograms) and
 * the `/metrics` controller. The HTTP timing middleware is wired globally in
 * main.ts (app.use) using the exported MetricsService — see
 * http-metrics.middleware.ts for why middleware over interceptor.
 */
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
