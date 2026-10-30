# How the OpenTelemetry POC works

## 1. What this project is
A small system that shows how to collect **traces** (timed records of what happened) from a **browser** and a
**Node backend**, join them into one trace, store them in SigNoz, and look at them in SigNoz and Grafana.

Vocabulary:
- **Span**: one timed operation (a click, an HTTP call, a database query).
- **Trace**: a tree of spans that belong to one user action, tied together by a **trace ID**.
- **Instrumentation**: code that creates spans automatically (for fetch, clicks, page load, HTTP server).
- **Exporter**: code that sends finished spans somewhere (here: OTLP over HTTP).
- **Collector**: a service that receives, processes and forwards telemetry.
- **traceparent**: an HTTP header (`00-<trace-id>-<parent-span-id>-<flags>`) that carries the trace across services.

## 2. Architecture

```
1. Browser app (Vite :5173) --OTLP/HTTP--> 3. Collector (Docker :4318) --OTLP--> 4. SigNoz (UI :8090, ClickHouse)
        |                                          ^                                     ^
        | fetch + traceparent header               | OTLP/HTTP                           | SQL
        v                                          |                                     |
2. Backend (Node :3000) ---------------------------+                   5. Grafana (:3001, ClickHouse plugin)
```

## 3. Folder layout and every file

| File | Purpose |
|---|---|
| `package.json` | Dependencies (exact versions) and scripts: `dev`, `build`, `backend`. |
| `package-lock.json` | Exact resolved versions, so installs are reproducible. |
| `index.html` | The demo page: 6 buttons and an output box. Loads `src/main.js`. |
| `src/telemetry.js`, `src/config.js`, `src/instruments.js`, `src/sdk/*` | Browser OpenTelemetry setup (the core of the POC). Opt-in: the SDK in `src/sdk/` loads only when enabled. See CONFIGURATION.md. |
| `src/main.js` | What each button does; creates manual spans. |
| `backend/tracing.cjs` | Node OpenTelemetry setup; loaded before the server with `node -r`. |
| `backend/server.cjs` | Small HTTP server for `/api/hello` with one manual child span. |
| `otel-collector.yaml` | Collector config: OTLP/HTTP receiver with CORS, memory limiter, batching, exporters. |
| `docker-compose.yaml` | Starts the Collector and Grafana (joined to SigNoz's Docker network). |
| `signoz/` | The SigNoz stack, vendored from the load-testing repo. |
| `infra/grafana/` | Grafana provisioning: ClickHouse data source and the SigNoz dashboard. |
| `.env.example` | Settings (`VITE_OTEL_ENABLED` and the rest, see CONFIGURATION.md). |
| `.gitignore` | Excludes `node_modules`, `dist`, `.env`. |
| `README.md` | Quick start and pinned versions. |
| `docs/HOW-IT-WORKS.md` | This file. |
| `docs/FINDINGS.md` | POC findings, risks and recommendation. |
| `docs/INTEGRATION.md` | Notes for React, Angular and Vue. |
| `docs/PRODUCTION-CHECKLIST.md` | What to do before production. |

## 4. The browser side (`src/sdk/traces.js` and friends), step by step
1. Reads config (collector URL, sampling ratio, environment, console debug flag).
2. Creates a **session ID** (stored in `sessionStorage`) so all spans from one tab session can be grouped.
3. Defines the **resource**: `service.name=browser-poc`, version, environment.
4. Builds **span processors**: a processor that adds `session.id`; a console exporter (debug); and a batching processor that sends spans to the collector through `RedactingExporter`.
5. `RedactingExporter` removes URL query strings and fragments, truncates exception messages to 200 characters and deletes stack traces, **before** data leaves the browser.
6. The **sampler** (`ParentBased(TraceIdRatio)`) decides which traces to keep. Ratio 1 keeps everything.
7. The **ZoneContextManager** (zone.js) tracks the current span across promises and timers.
8. **Instrumentations** patch the browser: `documentLoad`, user clicks, `fetch`, XHR. Fetch/XHR add `traceparent` only for origins in `PROPAGATE_TO` (`localhost:3000`), and ignore the collector URL.
9. **Global error hooks** (`error`, `unhandledrejection`) record `browser.error` spans.
10. **Web vitals** (LCP, CLS, INP, FCP, TTFB) are recorded as `web-vital.*` spans.
11. On `visibilitychange` (tab hidden) it flushes buffered spans.

## 5. The demo buttons (`src/main.js`)
| Button | What happens | Spans you will see |
|---|---|---|
| 1 Fetch public API | Calls jsonplaceholder | `click`, `HTTP GET` (no traceparent sent: origin not allowed) |
| 2 Fetch own backend | Calls `localhost:3000/api/hello` | `click`, `HTTP GET`, then backend `GET`, `db.query.simulated` in the **same trace** |
| 3 XHR request | Old-style request | `click`, `HTTP GET` |
| 4 Custom span | Nested manual spans | `click`, `checkout.submit`, `checkout.payment` |
| 5 Error span | Records a handled exception | `risky.operation` with ERROR status |
| 6 Unhandled error | Throws outside any handler | `browser.error` from the global hook |

Why button 4 passes the parent context by hand: zone.js cannot follow native `async/await`, so after the first
`await` the active span is lost. The code captures `parentCtx` before the `await` and passes it to the child span.

## 6. The backend side
- `backend/tracing.cjs` starts the Node SDK with HTTP instrumentation and sends spans to `OTLP_URL`
  (default `http://localhost:4318/v1/traces`). Service name: `backend-poc`.
- The HTTP instrumentation reads the incoming `traceparent` header and starts its server span inside the browser's trace.
- `backend/server.cjs` allows CORS for `traceparent`, waits 80 ms inside a manual `db.query.simulated` span, and replies with JSON.

## 7. The collector (`otel-collector.yaml`)
- **receiver** `otlp/http` on `0.0.0.0:4318` with CORS allowed for `http://localhost:5173`.
- **processors** `memory_limiter` (protects against spikes) and `batch`.
- **exporters** `otlp/signoz` (forwards to the SigNoz ingester) and `debug` (prints a line per batch, which you saw in the Docker terminal).

## 8. What happens when you click button 2
1. `click` span starts.
2. `fetch` creates an `HTTP GET` span and adds `traceparent: 00-<trace>-<span>-01`.
3. The backend reads the header; its `GET` span gets the same trace ID and the browser span as parent.
4. The backend creates `db.query.simulated` as a child.
5. Both sides batch spans and POST them to the collector (every ~2 s from the browser).
6. The collector forwards them to SigNoz, which joins them by trace ID into one tree:
   `click → HTTP GET → GET → db.query.simulated`.

## 9. Looking at the data
- **SigNoz** (http://localhost:8090): Services, Traces (open one to see `click -> HTTP GET -> GET -> db.query.simulated`), Logs, Metrics.
- **Grafana** (http://localhost:3001, folder OpenTelemetry): the dashboard reads SigNoz's ClickHouse tables. See COLLECTOR-AND-DASHBOARD.md.

## 10. Running everything
```bash
docker compose -f signoz/compose.yaml up -d   # SigNoz, first start takes a few minutes
docker compose up -d                          # collector + Grafana
npm install
npm run backend                               # terminal 1
npm run dev                                   # terminal 2, then open http://localhost:5173 and click the buttons
```

## 11. Troubleshooting
| Symptom | Likely cause and fix |
|---|---|
| `Cannot find module '@opentelemetry/sdk-node'` | Run `npm install` in the project folder. |
| `Failed to resolve import "web-vitals"` | Same: run `npm install`, restart `npm run dev`. |
| Port 5173 or 3000 already in use | Stop the other copy of the app (Ctrl+C). |
| CORS error mentioning `localhost:4318` | Open the page as `http://localhost:5173`, not `127.0.0.1`. |
| No `backend-poc` in SigNoz | Backend not started with `npm run backend` (and `OTEL_ENABLED=true`), or Docker not running. |
| Collector cannot reach SigNoz | Start SigNoz first (`docker compose -f signoz/compose.yaml up -d`); it creates the `signoz-network` the collector joins. |
| No web vitals yet | They are reported on a tab switch or reload. |
| Chart/Recharts errors in the Console | Not from this project; caused by another app or extension. |
| `EBUSY ... file watcher` on Windows | Harmless warning while files are replaced. |
