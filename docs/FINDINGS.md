# OpenTelemetry Browser POC: Findings and Recommendation

> **Note:** written for the first version of this POC (Jaeger, Prometheus, Loki, Grafana). The backend is now SigNoz with Grafana on top, and the report script was removed. The findings about the SDK, zone.js, privacy and versions still apply.

*27 October 2026. OpenTelemetry JS SDK 2.12, experimental packages 0.219.*

## 1. Summary
A working POC adds OpenTelemetry tracing to a browser app and a Node backend. Telemetry flows through an OpenTelemetry
Collector into Jaeger, and one trace spans the browser click, the HTTP call and the backend work.
**Recommendation: proceed to a pilot on one real application**, under the conditions in section 5, because upstream
labels browser support as experimental.

## 2. What was built
```
Browser (browser-poc) --OTLP/HTTP--> Collector --> Jaeger UI
    |
    +-- fetch with traceparent --> Backend (backend-poc) --OTLP/HTTP--> Collector
```
Browser auto-instrumentation (page load, clicks, fetch, XHR), manual spans, a Node backend that continues the browser
trace, sampling, URL/exception redaction, session IDs, global error capture, Core Web Vitals, and an automatic
Markdown report generated from Jaeger.

## 3. Verified in a real browser (Edge on Windows)
| Capability | Result |
|---|---|
| documentLoad, click, fetch and XHR spans | Works |
| Nested custom spans (after the async/await workaround) | Works |
| Handled and unhandled errors; no stack trace exported | Works |
| session.id on every span | Works |
| Core Web Vitals spans (web-vital.LCP seen) | Works |
| One trace across browser and backend (click, HTTP GET, backend GET, db.query.simulated) | Works |
| Automatic report generator | Tested against a simulated Jaeger API; run it on your live Jaeger to confirm |

## 4. Findings and issues
1. **Experimental browser support** upstream.
2. **Versions must be pinned as a set.** Latest-of-everything failed to install. Pinned: stable 2.12.0, experimental 0.219.0, API 1.9.1.
3. **Deprecation:** `sdk-trace-web` and `sdk-trace-base` are deprecated in favour of `@opentelemetry/sdk-trace` (3.x). Plan a migration.
4. **Native async/await loses context under zone.js.** Children created after an `await` became separate traces. Fix: capture the parent context before the first `await` and pass it explicitly.
5. **Security advisory** in `propagator-jaeger` (pulled by `sdk-node`); overridden to 2.12.0. The Jaeger propagator is unused.
6. **CORS is required end to end** (collector origin, and `traceparent`/`tracestate` headers on the backend).
7. **Bundle size:** about 45 kB gzipped (145 kB raw).

## 5. Risks and conditions for production
| Risk | Mitigation |
|---|---|
| API changes | Pin versions, upgrade as a set, test upgrades in CI |
| Personal data in spans | Keep the redacting exporter; review all custom attributes; avoid user identifiers without consent |
| Volume and cost | Sample 5 to 20 percent; keep errors via collector tail sampling |
| Public collector endpoint | Authenticating gateway, rate and size limits, real origin allow-list, TLS |
| Data lost on tab close | Flush on page hide; consider `sendBeacon` |
| Ad blockers | Send via a first-party path proxied to the collector |
| Consent | Initialise tracing after consent where required |
| Page weight | Lazy-load tracing after first paint |

See `docs/PRODUCTION-CHECKLIST.md` for the full list.

## 5b. Logs and metrics
Added afterwards; see `docs/LOGS-AND-METRICS.md`. Metrics are stable upstream, logs are still in development. Bundle grows to about 65 kB gzipped. Verified end to end in a real browser (metrics in Prometheus/Grafana, logs in Loki/Grafana). One gap: the one-click log-to-trace link in Grafana does not pass the trace id (workaround in `docs/LOGS-AND-METRICS.md`).

## 6. Next steps
1. Pilot on one real frontend and its main backend service (`docs/INTEGRATION.md`).
2. Deploy a gateway-fronted collector and connect the team's chosen backend (Jaeger is demo-only).
3. Set sampling, privacy and consent rules before wider rollout.
4. Review upstream browser support and the `sdk-trace` migration every quarter.

## 7. Pinned versions
| Packages | Version |
|---|---|
| sdk-trace-web, sdk-trace-base, resources, context-zone | 2.12.0 |
| exporter-trace-otlp-http, instrumentation, instrumentation-fetch, instrumentation-xml-http-request, sdk-node, instrumentation-http | 0.219.0 |
| @opentelemetry/api | 1.9.1 |
| instrumentation-document-load / instrumentation-user-interaction | 0.64.0 / 0.63.0 |
| web-vitals | 6.2.3 |
