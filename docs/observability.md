# Observabilidad

> Los tres pilares: **logs**, **métricas**, **trazas** (+ error tracking como pilar operativo aparte).
> Estado y decisiones pendientes abajo.

| Pilar | Estado | Herramienta |
| --- | --- | --- |
| **Logs** | ✅ Ya estaba | `nestjs-pino` (JSON estructurado, request-id por request) |
| **Métricas** | ✅ Agregado esta sesión | `prom-client` → endpoint `/metrics` (Prometheus) |
| **Trazas** | ⏳ Propuesto (pendiente de aprobación) | OpenTelemetry — requiere elegir backend |
| **Error tracking** | ⏳ Propuesto (pendiente de aprobación) | Sentry — requiere DSN |

---

## 1. Logs — ya existente

`nestjs-pino` reemplaza el logger default de Nest (`main.ts`: `app.useLogger(app.get(Logger))`).
Logs JSON estructurados con `req.id` (request-id) que permite trazar un request por todos sus logs.
Sin cambios esta sesión — está correcto.

---

## 2. Métricas — implementado (Prometheus)

### Qué se agregó

```
src/shared/infrastructure/metrics/
  metrics.service.ts          # Registry propio + collectDefaultMetrics + histograma HTTP
  metrics.controller.ts       # GET /metrics (@Public, formato text exposition)
  http-metrics.middleware.ts  # factory de middleware Express: cronometra y registra en res 'finish'
  metrics.module.ts           # provee + exporta MetricsService, declara el controller
```

Wiring:
- `app.module.ts`: importa `MetricsModule`.
- `main.ts`: `app.use(httpMetricsMiddleware(app.get(MetricsService)))` y `/metrics` excluido del prefijo `api/v1`.

### Decisiones de diseño (el *por qué*)

- **Registry propio, no el global de prom-client.** La suite de integración levanta múltiples apps en
  el mismo proceso; con el registry global, el segundo `collectDefaultMetrics` lanzaría "metric already
  registered". Un `Registry` por instancia de `MetricsService` (singleton) lo evita.
- **Middleware, no interceptor.** El status code final lo setea el exception filter *después* de que
  un interceptor ve la respuesta. `res.on('finish')` dispara después del filter → los 4xx/5xx se
  etiquetan correctamente. Por eso es middleware (`app.use`), no `APP_INTERCEPTOR`.
- **Label `route` = patrón de ruta (`/accounts/:id`), nunca la URL cruda.** Etiquetar por URL con ids
  reales explota la cardinalidad (una serie temporal por id). Se usa `req.route.path`.
- **`/metrics` es `@Public` y sin prefijo.** Prometheus no se autentica. En producción se restringe a
  nivel de red (scrape solo desde la subnet de monitoreo / detrás del LB), no con auth de app.

### Qué expone

- **Default de Node/proceso** (`collectDefaultMetrics`): event-loop lag, heap, GC, CPU, file descriptors.
- **`http_request_duration_seconds`** (Histogram) con labels `method`, `route`, `status_code`. El
  `_count` da el total de requests gratis; el histograma da p50/p95/p99 vía `histogram_quantile`.

Verificado end-to-end: `GET /metrics` → 200, `content-type: text/plain; version=0.0.4`, y
`http_request_duration_seconds_bucket{method="GET",route="/health",status_code="200"}` se registra.

### Cómo scrapearlo (Prometheus)

```yaml
scrape_configs:
  - job_name: personal-finance-api
    metrics_path: /metrics
    static_configs:
      - targets: ['personal-finance-api:3000']
```

### PromQL útil (para dashboards/alertas)

```promql
# p95 de latencia por ruta (últimos 5m)
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))

# tasa de 5xx
sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[5m]))

# throughput por ruta
sum(rate(http_request_duration_seconds_count[1m])) by (route)
```

---

## 3. Trazas — PROPUESTO (pendiente de aprobación)

OpenTelemetry para trazas distribuidas. **No implementado** porque requiere decisiones tuyas y un
backend corriendo (no quise wirearlo a ciegas — el SDK de auto-instrumentación puede interferir con
el arranque si se configura mal).

**Decisión necesaria:** ¿a qué backend exportamos?
- **Jaeger / Tempo** (self-hosted, OTLP) — gratis, lo levantas en docker-compose.
- **Vendor** (Honeycomb, Datadog, Grafana Cloud) — requiere API key.

**Esbozo de implementación** (cuando se apruebe):
- `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node` (instrumenta HTTP, Express,
  pg automáticamente → spans de cada request y cada query a Postgres, sin tocar el código de dominio).
- Inicializar el SDK **antes** de importar cualquier otra cosa (un `tracing.ts` requerido al inicio de
  `main.ts` con `node -r`).
- Exporter OTLP configurable por env (`OTEL_EXPORTER_OTLP_ENDPOINT`), **disabled por default** para no
  romper dev/test.
- Correlación: inyectar `trace_id` en los logs de pino → un log lleva a su traza.

**Valor específico aquí:** verías el span de cada `POST /transactions` desglosado — cuánto tarda el
`SELECT ... FOR UPDATE` del budget, cuánto espera por el lock, cuánto el del account. Para un sistema
cuyo corazón son los locks pesimistas, eso es oro para diagnosticar contención en producción.

---

## 4. Error tracking — PROPUESTO (pendiente de aprobación)

**Sentry** para captura de excepciones con stack trace, contexto del request y agrupación.
**No implementado** porque requiere un **DSN** (tu cuenta de Sentry).

**Esbozo** (cuando tengas el DSN):
- `@sentry/node`, inicializado en `main.ts` con `SENTRY_DSN` por env (disabled si no está seteado).
- Un `AllExceptionsFilter` global que reporte a Sentry **solo los 5xx** (los 4xx son errores de cliente
  esperados — no son incidentes). Hoy las excepciones de dominio mapeadas (4xx) no deben ir a Sentry;
  los `500` (lo no previsto) sí.
- Adjuntar `req.id` y `userId` (de `@CurrentUser`) al scope para contexto.

---

## Pendiente de aprobación (resumen)

1. **Métricas** → revisar la implementación (ya funciona); aprobar o ajustar buckets/labels.
2. **Trazas** → decidir backend (Jaeger self-hosted vs vendor) antes de implementar.
3. **Error tracking** → proveer `SENTRY_DSN` (o decidir alternativa) antes de implementar.
