# OpenTelemetry Browser POC

Browser + backend traces, metrics and logs with OpenTelemetry JS (SDK 2.x) -> OTel Collector -> SigNoz, with Grafana on top of SigNoz.
Note: browser instrumentation in OpenTelemetry JS is still marked *experimental* upstream.

    Browser (browser-poc) --OTLP/HTTP--> Collector --OTLP--> SigNoz (ClickHouse) <-- Grafana
        |
        +-- fetch + traceparent --> Backend (backend-poc) --OTLP/HTTP--> Collector

The SigNoz stack in `signoz/` comes from the load-testing repo (`signoz-foundry`).

## Prerequisites
Node.js 20+ and Docker (Docker Compose). About 15 GB of free disk for the SigNoz images and data.

## Telemetry is opt-in
Off by default: no SDK loaded, nothing patched, nothing sent. To try the demo, `cp .env.example .env` (sets `VITE_OTEL_ENABLED=true`).
Signals, features, sampling and user consent are all configurable: see docs/CONFIGURATION.md.
Backend: `OTEL_ENABLED=true npm run backend` (PowerShell: `$env:OTEL_ENABLED="true"; npm run backend`).

## Run it
    npm install
    cp .env.example .env                                # PowerShell: copy .env.example .env
    docker compose -f signoz/compose.yaml up -d         # 1) SigNoz (first start takes a few minutes), UI http://localhost:8090
    docker compose up -d                                # 2) collector :4318 + Grafana :3001
    npm run backend                                     # backend :3000 (instrumented), own terminal
    npm run dev                                         # browser app :5173, own terminal

Open http://localhost:5173 and click the buttons (telemetry must be enabled). Then look at:
- SigNoz, http://localhost:8090: Services (`browser-poc`, `backend-poc`), Traces, Logs, Metrics.
- Grafana, http://localhost:3001: folder **OpenTelemetry**, dashboard **OpenTelemetry: browser overview (SigNoz)**.

## What each button shows
1. Public fetch  2. Own backend (one trace across browser + backend: click -> HTTP GET -> backend GET -> db.query.simulated)
3. XHR  4. Custom nested spans  5. Handled error span  6. Unhandled error (`browser.error`)
7. Send logs (one inside a span, so it carries the trace id)  8. Record a custom metric
Also automatic: documentLoad, clicks, Core Web Vitals (`web-vital.*`), `session.id` on every span.

## Docs
- docs/CONFIGURATION.md  opt-in switches, per-signal/feature options, consent API
- docs/COLLECTOR-AND-DASHBOARD.md  SigNoz as backend with Grafana on top (vendored from the load-testing repo), CORS, dashboards
- signoz/  the SigNoz stack from the load-testing repo (`docker compose -f signoz/compose.yaml up -d`)
- docs/LOGS-AND-METRICS.md  logs + metrics design, queries, what was verified
- docs/HOW-IT-WORKS.md  full explanation of every file and the data flow
- docs/FINDINGS.md  findings and recommendation (written for the first version with Jaeger, Prometheus and Loki)
- docs/INTEGRATION.md, docs/PRODUCTION-CHECKLIST.md

## Files
- src/telemetry.js   the only entry point: initTelemetry / grantConsent / revokeConsent / stopTelemetry (loads the SDK lazily)
- src/config.js   defaults + .env + options, consent storage (no OTel imports)
- src/instruments.js   metric instruments, log()/logError() on the API only (no-ops while telemetry is off)
- src/sdk/   the real SDK setup, loaded only when enabled: traces.js, metrics.js, logs.js, browser-events.js, index.js
- src/main.js      demo buttons
- backend/tracing.cjs, backend/server.cjs   instrumented Node backend
- otel-collector.yaml, docker-compose.yaml   collector and Grafana (the SigNoz stack is in signoz/)
- infra/grafana/   Grafana provisioning: ClickHouse data source and the SigNoz dashboard
- docs/INTEGRATION.md       React / Angular / Vue notes
- docs/PRODUCTION-CHECKLIST.md   what to do before production
- .env.example              VITE_OTEL_ENABLED, VITE_OTEL_REQUIRE_CONSENT, VITE_OTEL_SIGNALS, VITE_OTEL_FEATURES, VITE_OTLP_BASE_URL, VITE_SAMPLE_RATIO, ...

## Pinned versions (important)
Stable (sdk-trace-web/base, resources, context-zone) 2.12.0; experimental (exporter, instrumentation, fetch, xhr, sdk-node,
instrumentation-http) 0.219.0; @opentelemetry/api 1.9.1 (SDK 2.12 needs api < 1.10);
instrumentation-document-load 0.64.0 / user-interaction 0.63.0 match the 0.219 line.
`overrides` pins propagator-jaeger 2.12.0 to clear a DoS advisory pulled in by sdk-node (the Jaeger propagator is unused here).
Mixing "latest" of everything currently fails to install/build. sdk-trace-web/base are deprecated in favour of
`@opentelemetry/sdk-trace` (3.x line) - revisit when 3.x is stable for browsers.

## Known limitation found during the POC
zone.js cannot track native async/await: after the first `await` the active span is lost and new spans become
separate root traces. Capture the parent context before the await and pass it explicitly (button 4 in src/main.js).
