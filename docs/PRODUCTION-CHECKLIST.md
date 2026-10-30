# Production checklist

| Area | Status in POC | To do for production |
|---|---|---|
| Sampling | `ParentBased(TraceIdRatio)`, ratio via `VITE_SAMPLE_RATIO` (default 1) | Set 0.05-0.2; sample errors at 100% via collector tail sampling |
| PII | URL query/fragment stripped, exception messages truncated, stack traces dropped (`RedactingExporter`) | Review every custom attribute; never put emails, names, tokens, form values in spans |
| Session correlation | Random `session.id` per tab session | Decide policy for user ids (privacy/consent) |
| Errors | `window.onerror` + `unhandledrejection` -> spans | Add framework error boundary/handler (see INTEGRATION.md) |
| Web vitals | LCP, CLS, INP, FCP, TTFB as spans | Consider sending as metrics instead of spans once browser metrics are stable |
| Data loss on tab close | Flush on `visibilitychange` | Consider `navigator.sendBeacon`-based export for last batch |
| Collector exposure | Open on :4318 with CORS for localhost | Put behind a gateway: auth/rate limits/size limits, real origin allow-list, TLS |
| Collector resilience | `memory_limiter` + `batch` | Run 2+ replicas, add retry/queue, monitor drops |
| Backend | Node SDK + HTTP instrumentation, continues browser trace | Add framework/DB instrumentations, use the same collector |
| Versions | Pinned (see README) | Upgrade as a set; plan migration to `@opentelemetry/sdk-trace` (3.x) |
| Bundle size | ~7 kB gzipped always loaded; SDK chunks (~60 kB gz) load only when enabled | Call `initTelemetry()` after first paint if the page-load budget is tight |
| Ad blockers | Not handled | Send via a first-party path (e.g. `/telemetry`) proxied to the collector |
| Opt-in / consent | Off by default (`VITE_OTEL_ENABLED`); optional user consent (`VITE_OTEL_REQUIRE_CONSENT` + `grantConsent()`/`revokeConsent()`) | Wire `grantConsent()` to your real consent banner; decide whether production should require consent |
| Metrics cardinality | Low-cardinality attributes only; no session/user ids | Review every new metric attribute; never URLs, ids or emails |
| Metrics export interval | 10 s | 30-60 s; flush on page hide is already in place |
| Logs volume and privacy | Body truncated, e-mails replaced, no stack traces, console warn/error captured | Decide what may be logged; add a level threshold (e.g. warn and above only) or sampling |
| Logs maturity | Upstream status: Development | Pin versions; re-test on every upgrade |
| SigNoz / Grafana | Local SigNoz (default ClickHouse user, no password), anonymous-admin Grafana | Use the team's real SigNoz; set proper credentials; never expose the demo Grafana |
