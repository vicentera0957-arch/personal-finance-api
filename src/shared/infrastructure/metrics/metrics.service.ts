import { Injectable } from '@nestjs/common';
import { Registry, collectDefaultMetrics, Histogram } from 'prom-client';

/**
 * Owns a dedicated prom-client Registry (NOT the global default one) so that
 * spinning up multiple Nest apps in the same process — as the integration test
 * suite does — never throws "metric already registered". One registry per
 * MetricsService instance; the service is a singleton, so one per app.
 *
 * Exposes:
 *   - default Node/process metrics (event loop lag, heap, GC, CPU) via collectDefaultMetrics
 *   - http_request_duration_seconds histogram (the _count gives request totals for free)
 */
@Injectable()
export class MetricsService {
  readonly registry: Registry;
  private readonly httpRequestDuration: Histogram<string>;

  constructor() {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ app: 'personal-finance-api' });
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
  }

  /** Record one finished HTTP request. `route` must be the low-cardinality
   *  pattern (e.g. /accounts/:id), never the raw URL with ids. */
  observeHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    this.httpRequestDuration.observe(
      { method, route, status_code: String(statusCode) },
      durationSeconds,
    );
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
