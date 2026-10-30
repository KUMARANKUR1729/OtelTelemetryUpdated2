# Logs and metrics

> **Note:** the sections below that mention Jaeger, Prometheus, Loki and `npm run report` describe the first version of this POC, which has been replaced by SigNoz. The SDK design points still apply.


Traces were the first signal. This adds the other two over the same path:

    Browser --OTLP/HTTP--> Collector --OTLP--> SigNoz (traces, metrics and logs) <-- Grafana
                                                 Grafana :3001 reads all three

## Files
| File | Purpose |
|---|---|
| `src/config.js` | Opt-in switches, collector URL, per-signal/feature settings (see CONFIGURATION.md) |
| `src/instruments.js` | Instruments, `log()` / `logError()`, fetch/XHR duration processor; API only, no-ops while telemetry is off |
| `src/sdk/` | MeterProvider, LoggerProvider, TracerProvider, console capture, errors, web vitals; loaded only when enabled |
| `src/telemetry.js` | Entry point: starts/stops the SDK, consent, status |

## What is recorded
**Metrics** (exported every 10 s): `app.ui.clicks`, `browser.errors`, `browser.http.client.duration` (automatic for every fetch/XHR),
`web_vital.{lcp,fcp,ttfb,inp,cls}` histograms, plus custom `app.orders.completed` and `app.order.value` (button 8).
**Logs**: `log(level, body, attrs)`, errors from `window.onerror`/`unhandledrejection`, and `console.warn/error`.
A log emitted while a span is active carries that span's `trace_id`/`span_id` automatically.

## Viewing it (SigNoz and Grafana)
- **SigNoz** (http://localhost:8090): Logs and Metrics views, and Traces. Filter by service `browser-poc`.
- **Grafana** (http://localhost:3001): dashboard **OpenTelemetry: browser overview (SigNoz)** (details in COLLECTOR-AND-DASHBOARD.md).


## Generating the evidence report
`npm run report` writes `reports/latest.md` (and a timestamped copy) from all three backends: a pass/fail checklist (traces, metrics, logs,
trace correlation, redaction), per-operation timings, click/HTTP/web-vital metrics, log levels and the latest log lines. If a backend is down,
the report says so instead of failing. Run it after clicking all 8 buttons and before `docker compose down`, because the demo
containers keep no data. The report is the evidence; the conclusions in `docs/FINDINGS.md` are still yours to write.

## Design decisions
- **No `session.id` on metrics.** A unique id per session creates one time series per user and overloads the metrics store.
  It stays on spans and logs, where high cardinality is fine. Metric attributes are low-cardinality only (host, method, status, tier).
- **HTTP duration is derived from spans** (`HttpMetricsSpanProcessor`), so there is no per-call code and the URL is never a label.
- **Web vitals are sent both as spans and as histograms.** Spans answer "what happened on this page view";
  histograms answer "what is our p75 LCP this week".
- **Same privacy rules as traces.** Log bodies are truncated to 500 characters, e-mail addresses are replaced, and error logs
  carry type + message only (no stack trace).
- **Console capture is on by default once telemetry is enabled** (`consoleCapture` feature; `VITE_OTEL_FEATURES` or legacy `VITE_CAPTURE_CONSOLE`). Turn it off if third-party scripts make the
  console noisy or may print personal data.

## Findings
1. Upstream status (repo README): **metrics API/SDK stable, logs API/SDK still "Development"**. Pin versions and expect log API changes.
2. Bundle size rose from about 45 kB to about 65 kB gzipped (traces only vs all three signals).
3. The collector prints a deprecation warning for `resource_to_telemetry_conversion` on the Prometheus exporter
   (the replacement is `resource_constant_labels`). It still works in v0.164.0; change it when upgrading the collector.
4. Metrics are batched every 10 s, so a short visit can lose the last interval. The page-hide handler calls `forceFlush()`
   on all three providers to reduce this.
5. **Counter correctness with many users is untested.** Browser counters are cumulative per tab, so a page reload restarts them, and
   several browsers sharing one Resource would write to the same Prometheus series. Before relying on the totals, investigate delta
   temporality plus the collector's `deltatocumulative` processor. The POC was only exercised from one browser.
6. Jaeger only stores traces, which is why Prometheus, Loki and Grafana were added. Production would use whatever backend the team already has.

## What was and was not verified
**Verified in a real browser (Chrome/Edge via Vite, containers via Docker Compose):**
- Metrics: browser -> collector -> Prometheus (target UP) -> Grafana. Custom counters/histograms, per-button click counts,
  `browser_errors_total`, and `browser_http_client_duration_milliseconds` built from real fetch spans (e.g. `server_address="jsonplaceholder.typicode.com"`).
- Logs: browser -> collector -> Loki -> Grafana. Log levels, `console.warn` capture, unhandled-error log, e-mail redaction (`[email]`),
  `session_id`, `service_name` and `deployment_environment_name` as labels.
- Trace correlation data: logs emitted inside a span carry `trace_id`, `span_id` and `flags`.
- Trace propagation to the backend (`traceparent` received by the Node backend).
- `npm run report` was tested against real Prometheus 3.15.1 and Loki 3.7.9 (checks pass on good data and fail when an unredacted e-mail is injected).
  Its Jaeger half was changed only to tolerate Jaeger being down and was not rerun against a live Jaeger.
- Before the browser run: the collector config was validated and run on v0.164.0, and the real `src/logs.js` / `src/metrics.js` were tested from Node.

**Known gap:** the clickable **Jaeger** link on a Loki log line (Grafana derived field on `trace_id`) appears in Grafana 13.2.4 but
opens Jaeger Explore with an **empty query**, so the trace id is not passed through. Workaround: copy `trace_id` from the log line and open
`http://localhost:16686/trace/<trace_id>`. Root cause not investigated (Grafana's handling of Loki structured metadata, or the provisioning
in `infra/grafana/datasources.yaml`). Not needed for production use of the POC findings: the correlation data itself is correct.
