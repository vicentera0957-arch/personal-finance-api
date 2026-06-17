import { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Factory for an Express middleware that times every request and records it on
 * `res.on('finish')` — which fires AFTER the exception filter has set the final
 * status code, so 4xx/5xx are labeled correctly (an interceptor would see the
 * pre-filter status). Registered globally in main.ts via `app.use(...)`, so it
 * runs for every route regardless of the `api/v1` prefix.
 *
 * Uses the matched route pattern (`req.route.path`, e.g. /accounts/:id) as the
 * label, never the raw URL — labeling by URL would explode cardinality with one
 * time series per id.
 */
export function httpMetricsMiddleware(metricsService: MetricsService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = req.route?.path ?? 'unmatched';
      metricsService.observeHttpRequest(
        req.method,
        route,
        res.statusCode,
        durationSeconds,
      );
    });
    next();
  };
}
