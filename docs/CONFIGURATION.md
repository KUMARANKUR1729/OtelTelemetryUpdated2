# Configuration: configurable and opt-in only

**Telemetry is OFF by default.** With no `.env` and no options, the app behaves as if OpenTelemetry were not installed:
no SDK code is downloaded, `fetch`/`XMLHttpRequest` are not patched, `zone.js` is not loaded, `sessionStorage` is not
written, and no request goes to the collector. App code can still call the OpenTelemetry API (`trace`, `log()`, metrics);
those calls are no-ops until telemetry is switched on.

## Switches (all default to the safest value)

| Setting (`.env` / option) | Default | Meaning |
|---|---|---|
| `VITE_OTEL_ENABLED` / `enabled` | `false` | Master opt-in. Nothing starts without it. |
| `VITE_OTEL_REQUIRE_CONSENT` / `requireConsent` | `false` | Also wait for the user: starts only after `grantConsent()`; `revokeConsent()` stops it. Choice is kept in `localStorage` (`otel.consent`). |
| `VITE_OTEL_SIGNALS` / `signals` | all three | Which of `traces,metrics,logs` to send. A switched-off signal loads no code. |
| `VITE_OTEL_FEATURES` / `features` | all | `documentLoad,userInteraction,fetch,xhr,webVitals,errors,consoleCapture`. |
| `VITE_SAMPLE_RATIO` / `sampleRatio` | `1` | Trace sampling, 0..1 (parent-based). |
| `VITE_OTLP_BASE_URL` / `otlpBase` | `http://localhost:4318` | Collector base URL. It is never traced itself. |
| `VITE_OTEL_PROPAGATE_TO` / `propagateTo` | `localhost:3000` | Only these origins get the `traceparent` header. |
| `VITE_OTEL_IGNORE_URLS` / `ignoreUrls` | none | Extra URLs never traced. |
| `VITE_OTEL_METRICS_INTERVAL_MS` / `metricsIntervalMs` | `10000` | Metric export interval. |
| `VITE_CONSOLE_SPANS` / `consoleDebug` | `false` | Also print spans/logs to the console. |

Precedence: defaults < `.env` < options passed to `initTelemetry()`.

## Usage

```js
import { initTelemetry, grantConsent, revokeConsent, stopTelemetry, getTelemetryStatus } from './telemetry.js';

initTelemetry();                                   // off unless .env opts in
initTelemetry({ enabled: true, signals: { logs: false }, features: { consoleCapture: false } });
initTelemetry({ enabled: true, requireConsent: true });  // then call grantConsent() from your consent banner
```
`revokeConsent()` flushes, restores the original `fetch`/XHR/`console`, shuts the providers down and removes listeners.
`getTelemetryStatus()` returns `{ status: 'off' | 'waiting-consent' | 'starting' | 'on', reason, signals, ... }`.

## Notes and limits
- Requests made before the lazily loaded SDK finishes starting are not traced. If the first request matters, `await initTelemetry()` before it.
- `browser.http.client.duration` is derived from fetch/XHR spans, so it needs `traces` and `metrics` both on.
- The metrics API cannot hand out working meters before the SDK starts, so instruments are created lazily (`byMeterProvider` in `src/instruments.js`). Use that helper for your own metrics.
- Backend: `OTEL_ENABLED=true` (default off), `OTEL_TRACES_ENABLED`, `OTEL_SAMPLE_RATIO`, `OTEL_SERVICE_NAME`, `OTLP_URL`. When off, the Node SDK packages are not even `require`d.
  Windows PowerShell: `$env:OTEL_ENABLED="true"; npm run backend`.
