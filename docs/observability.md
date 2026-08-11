# Observability

The three pillars — **logs**, **metrics**, **traces** — plus error tracking as a fourth
operational concern. Two are in place; two are deliberately not, and this document says
what each would cost to add.

| Pillar | Status | Tool |
| --- | --- | --- |
| **Logs** | In place | `nestjs-pino` — structured JSON, request-id per request |
| **Metrics** | In place | `prom-client` → `/metrics` (Prometheus exposition format) |
| **Traces** | Not implemented | OpenTelemetry — blocked on choosing a backend |
| **Error tracking** | Not implemented | Sentry — blocked on a DSN |

---

## 1. Logs

`nestjs-pino` replaces Nest's default logger (`main.ts`: `app.useLogger(app.get(Logger))`).
Structured JSON with `req.id`, so every log line from one request can be correlated.

---

## 2. Metrics (Prometheus)

```
src/shared/infrastructure/metrics/
  metrics.service.ts          # own registry + collectDefaultMetrics + HTTP histogram
  metrics.controller.ts       # GET /metrics (@Public, text exposition format)
  http-metrics.middleware.ts  # Express middleware: times and records on res 'finish'
  metrics.module.ts           # provides + exports MetricsService, declares the controller
```

Wired in `app.module.ts` (imports `MetricsModule`) and `main.ts`
(`app.use(httpMetricsMiddleware(...))`, with `/metrics` excluded from the `api/v1` prefix).

### Design decisions

- **Its own registry, not `prom-client`'s global one.** The integration suite boots
  several apps in one process; against the global registry the second
  `collectDefaultMetrics()` throws "metric already registered". One `Registry` per
  `MetricsService` instance avoids it.
- **Middleware, not an interceptor.** The final status code is set by the exception
  filter *after* an interceptor sees the response, so an interceptor would mislabel
  every mapped domain exception. `res.on('finish')` fires after the filter, so 4xx/5xx
  are labelled correctly. That is why this is `app.use()` and not `APP_INTERCEPTOR`.
- **The `route` label is the route pattern (`/accounts/:id`), never the raw URL.**
  Labelling by URL with real ids means one time series per id — unbounded cardinality,
  which is the standard way to take down a Prometheus server. `req.route.path` is used.
- **`/metrics` is `@Public` and unprefixed.** Prometheus does not authenticate. In
  production it is restricted at the network layer (scrape only from the monitoring
  subnet, or behind the load balancer), not with application auth.

### What it exposes

- **Node/process defaults** (`collectDefaultMetrics`): event-loop lag, heap, GC, CPU,
  file descriptors.
- **`http_request_duration_seconds`** (histogram) labelled `method`, `route`,
  `status_code`. `_count` gives throughput for free; the buckets give p50/p95/p99 via
  `histogram_quantile`.

Verified end to end by `test/integration/metrics/metrics.integration.spec.ts`:
`GET /metrics` returns 200 with `content-type: text/plain; version=0.0.4` and the
default metrics present.

### Scrape config

```yaml
scrape_configs:
  - job_name: personal-finance-api
    metrics_path: /metrics
    static_configs:
      - targets: ['personal-finance-api:3000']
```

### Useful PromQL

```promql
# p95 latency per route (last 5m)
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))

# 5xx rate
sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[5m]))

# throughput per route
sum(rate(http_request_duration_seconds_count[1m])) by (route)
```

---

## 3. Traces — not implemented

OpenTelemetry, for distributed traces. Not wired because it needs a decision that isn't
a code decision: **which backend to export to.** Self-hosted (Jaeger or Tempo over OTLP,
free, runs in `docker-compose`) or a vendor (Honeycomb, Datadog, Grafana Cloud, needs an
API key). Wiring the SDK without a destination would add startup risk for no signal —
the auto-instrumentation SDK can interfere with boot if misconfigured.

Implementation sketch, once a backend is chosen:

- `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node`, which
  instruments HTTP, Express and `pg` automatically — spans per request and per query,
  without touching domain code.
- Initialise the SDK **before** anything else is imported: a `tracing.ts` loaded via
  `node -r` ahead of `main.ts`.
- OTLP exporter configured by env (`OTEL_EXPORTER_OTLP_ENDPOINT`), **off by default** so
  dev and test are unaffected.
- Inject `trace_id` into the pino logs, so a log line leads to its trace.

**Why this is the highest-value gap in this specific system.** Every `POST /transactions`
takes two pessimistic row locks. A trace would break that request down into how long the
budget `SELECT ... FOR UPDATE` waited, how long the account one waited, and how long the
work between them took. For an architecture whose correctness rests on lock ordering and
contention, lock-wait time in production is the one number that can't be inferred from
anything already collected.

---

## 4. Error tracking — not implemented

Sentry, for exception capture with stack trace, request context and grouping. Not wired
because it needs a **DSN**, which means an account.

Sketch:

- `@sentry/node`, initialised in `main.ts` from `SENTRY_DSN` (disabled when unset).
- A global `AllExceptionsFilter` reporting **only 5xx**. Mapped domain exceptions are
  4xx — expected client errors, not incidents. Sending them would bury the real signal.
- Attach `req.id` and the `userId` from `@CurrentUser()` to the scope for context.

Note that this filter and the one proposed in
[ADR-0006](./adr/0006-domain-exceptions-vs-http.md) are the same object: if the
domain→HTTP mapping ever moves into a global `@Catch()` filter, error reporting is a
few lines in that same place.
