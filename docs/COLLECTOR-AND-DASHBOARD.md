# SigNoz as the backend, Grafana on top, the collector in front

## The idea
Apps talk to **one collector** and never to a backend. The collector forwards to **SigNoz**, and **Grafana reads SigNoz's ClickHouse store directly**.
SigNoz is the system of record; Grafana is the dashboard layer. There is no Jaeger, Prometheus or Loki.

```
browser / backend --OTLP--> POC collector --OTLP--> SigNoz ingester --> ClickHouse <-- Grafana (ClickHouse plugin)
```
The SigNoz stack in `signoz/` is vendored from the load-testing repo (`signoz-foundry`), so it is the setup the team already uses.

## Run it
```bash
# 1) SigNoz (first start takes a few minutes: schema migration). UI: http://localhost:8090 (create the admin account)
docker compose -f signoz/compose.yaml up -d
# 2) Collector + Grafana. Grafana: http://localhost:3001
docker compose up -d
```
Then `npm run dev`, click the demo buttons, and open Grafana, folder **OpenTelemetry**, dashboard **OpenTelemetry: browser overview (SigNoz)**.

How the pieces connect:
- Both Compose projects share the Docker network `signoz-network` (created by `signoz/compose.yaml`, so start SigNoz first). The collector reaches the ingester as `signoz-ingester:4317`;
  Grafana reaches ClickHouse as `signoz-telemetrystore-clickhouse-0-0:9000` (default user, empty password: SigNoz's dev setup; ClickHouse is not exposed on the host).
- The only change to Avik's files: the ingester's host ports are `14317`/`14318` instead of `4317`/`4318`, so they do not clash with the POC collector on `4318`.
- Grafana installs the `grafana-clickhouse-datasource` plugin on first start (needs internet).
- **SigNoz Cloud instead of local:** in `otel-collector.yaml` set `SIGNOZ_OTLP_ENDPOINT`, uncomment `headers` with `SIGNOZ_INGESTION_KEY`, remove `tls.insecure`.
  Grafana would then need SigNoz Cloud's own query route instead of ClickHouse.

## Other settings
- **Environment grouping:** the SDK sets both `deployment.environment.name` and the older `deployment.environment`; SigNoz groups by the older one.
- **CORS:** the browser calls the POC collector, so it must allow the app's origin. Set `CORS_ORIGIN` or add lines under `allowed_origins` in `otel-collector.yaml` (Symphony, Nexus, ...).
  If a browser were ever pointed straight at the SigNoz ingester, add a `cors` block to `receivers.otlp.protocols.http` in `signoz/ingester/ingester.yaml`; fronting it with this collector is safer.
- **Collector port:** `COLLECTOR_HTTP_PORT` (default 4318); match `VITE_OTLP_BASE_URL`.

## The dashboard
`infra/grafana/dashboards/otel-browser-signoz.json`

| Section | Reads | Notes |
|---|---|---|
| Traffic and latency | spans (`signoz_traces.distributed_signoz_index_v3`) | request count, error rate, rate by status, **exact** p50/p95/p99, by server, slowest requests with a link into SigNoz |
| Web vitals | the `web-vital.*` spans | p75 of the real reported values, with good/poor thresholds |
| Errors and events | error spans; `app.ui.clicks` and `app.orders.completed` metrics | clicks and orders are cumulative totals, not limited to the time range |
| Logs | `signoz_logs.distributed_logs_v2` | volume by severity, warnings and errors |

**What was verified, and what was not** (I had no running SigNoz or Grafana here):
- Table and column names were checked against SigNoz's own schema-migration source (`SigNoz/signoz-otel-collector`, traces and metrics tables; logs partly).
- All 18 dashboard queries were run in an embedded ClickHouse against locally created tables with those columns and sample spans, logs and metrics. They executed without errors and returned the expected values.
  That proves the SQL is valid for those columns, not that a live SigNoz has the same data in the same shape.
- Not verified: rendering in Grafana, and SigNoz's metric naming and temporality for the two metric panels (clicks, orders).
  SigNoz schemas change between versions (the foundry compose uses `:latest` images), so if a panel errors, compare the column names with the ClickHouse tables in your running SigNoz.
