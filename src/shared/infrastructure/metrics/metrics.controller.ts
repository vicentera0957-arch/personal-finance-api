import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../modules/auth/infrastructure/decorators/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint. Public (no JWT — Prometheus can't authenticate)
 * and excluded from the `api/v1` prefix in main.ts, so it lives at `/metrics`.
 *
 * In production, restrict access at the network layer (scrape only from the
 * monitoring subnet / behind the LB), not with app auth.
 */
@ApiTags('metrics')
@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics (text exposition format).' })
  metrics(): Promise<string> {
    return this.metricsService.metrics();
  }
}
