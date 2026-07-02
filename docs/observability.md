# Observability

> The three pillars: **logs**, **metrics**, **traces** (+ error tracking as a separate operational pillar).
> Status and pending decisions below.

| Pillar | Status | Tool |
| --- | --- | --- |
| **Logs** | Already in place | `nestjs-pino` (structured JSON, per-request request-id) |
| **Metrics** | Added this session | `prom-client` → `/metrics` endpoint (Prometheus) |
| **Traces** | Proposed (pending approval) | OpenTelemetry — requires choosing a backend |
| **Error tracking** | Proposed (pending approval) | Sentry — requires a DSN |

---

## 1. Logs — already existing

`nestjs-pino` replaces Nest's default logger (`main.ts`: `app.useLogger(app.get(Logger))`).
Structured JSON logs with `req.id` (request-id), which lets you trace a request across all its logs.
No changes this session — it is correct as-is.

---

## 2. Metrics — implemented (Prometheus)

### What was added

```
src/shared/infrastructure/metrics/
  metrics.service.ts          # Own registry + collectDefaultMetrics + HTTP histogram
  metrics.controller.ts       # GET /metrics (@Public, text exposition format)
  http-metrics.middleware.ts  # Express middleware factory: times and records on res 'finish'
  metrics.module.ts           # provides + exports MetricsService, declares the controller
```

Wiring:
- `app.module.ts`: imports `MetricsModule`.
- `main.ts`: `app.use(httpMetricsMiddleware(app.get(MetricsService)))` and `/metrics` excluded from the `api/v1` prefix.

### Design decisions (the *why*)

- **Own registry, not prom-client's global one.** The integration suite boots multiple apps in
  the same process; with the global registry, the second `collectDefaultMetrics` would throw "metric already
  registered". One `Registry` per `MetricsService` instance (singleton) avoids it.
- **Middleware, not interceptor.** The final status code is set by the exception filter *after*
  an interceptor sees the response. `res.on('finish')` fires after the filter → 4xx/5xx are
  labeled correctly. That is why it is middleware (`app.use`), not `APP_INTERCEPTOR`.
- **`route` label = route pattern (`/accounts/:id`), never the raw URL.** Labeling by URL with real
  ids explodes cardinality (one time series per id). `req.route.path` is used.
- **`/metrics` is `@Public` and unprefixed.** Prometheus doesn't authenticate. In production it is restricted at
  the network level (scrape only from the monitoring subnet / behind the LB), not with app auth.

### What it exposes

- **Node/process defaults** (`collectDefaultMetrics`): event-loop lag, heap, GC, CPU, file descriptors.
- **`http_request_duration_seconds`** (Histogram) with `method`, `route`, `status_code` labels. The
  `_count` gives the total requests for free; the histogram gives p50/p95/p99 via `histogram_quantile`.

Verified end-to-end: `GET /metrics` → 200, `content-type: text/plain; version=0.0.4`, and
`http_request_duration_seconds_bucket{method="GET",route="/health",status_code="200"}` is recorded.

### How to scrape it (Prometheus)

```yaml
scrape_configs:
  - job_name: personal-finance-api
    metrics_path: /metrics
    static_configs:
      - targets: ['personal-finance-api:3000']
```

### Useful PromQL (for dashboards/alerts)

```promql
# latency p95 per route (last 5m)
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))

# 5xx rate
sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[5m]))

# throughput per route
sum(rate(http_request_duration_seconds_count[1m])) by (route)
```

---

## 3. Traces — PROPOSED (pending approval)

OpenTelemetry for distributed traces. **Not implemented** because it requires decisions from you and a
running backend (I didn't want to wire it blindly — the auto-instrumentation SDK can interfere with
startup if misconfigured).

**Decision needed:** which backend do we export to?
- **Jaeger / Tempo** (self-hosted, OTLP) — free, spun up in docker-compose.
- **Vendor** (Honeycomb, Datadog, Grafana Cloud) — requires an API key.

**Implementation sketch** (once approved):
- `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node` (automatically instruments HTTP, Express,
  pg → spans for each request and each Postgres query, without touching domain code).
- Initialize the SDK **before** importing anything else (a `tracing.ts` required at the start of
  `main.ts` with `node -r`).
- OTLP exporter configurable via env (`OTEL_EXPORTER_OTLP_ENDPOINT`), **disabled by default** so as not to
  break dev/test.
- Correlation: inject `trace_id` into the pino logs → a log leads to its trace.

**Specific value here:** you would see the span of each `POST /transactions` broken down — how long the
budget's `SELECT ... FOR UPDATE` takes, how long it waits for the lock, how long the account's takes. For a system
whose heart is pessimistic locks, that is gold for diagnosing contention in production.

---

## 4. Error tracking — PROPOSED (pending approval)

**Sentry** for exception capture with stack trace, request context and grouping.
**Not implemented** because it requires a **DSN** (your Sentry account).

**Sketch** (once you have the DSN):
- `@sentry/node`, initialized in `main.ts` with `SENTRY_DSN` from env (disabled if not set).
- A global `AllExceptionsFilter` that reports to Sentry **only the 5xx** (4xx are expected client
  errors — not incidents). Today the mapped domain exceptions (4xx) must not go to Sentry;
  the `500`s (the unforeseen) must.
- Attach `req.id` and `userId` (from `@CurrentUser`) to the scope for context.

---

## Pending approval (summary)

1. **Metrics** → review the implementation (it already works); approve or tune buckets/labels.
2. **Traces** → decide on a backend (self-hosted Jaeger vs vendor) before implementing.
3. **Error tracking** → provide `SENTRY_DSN` (or decide on an alternative) before implementing.
