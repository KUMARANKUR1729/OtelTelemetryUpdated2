// Metric instruments, log helpers and the HTTP-duration span processor, built ONLY on the OpenTelemetry API packages.
// The API is a no-op until an SDK is registered, so app code can call these freely while telemetry is off:
// nothing is recorded, nothing is sent.
import { metrics } from '@opentelemetry/api';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

// Unlike traces and logs, the metrics API has no proxy: a meter obtained BEFORE the SDK starts stays a no-op forever.
// So instruments are (re)created lazily whenever the global MeterProvider changes (telemetry turned on / off / on).
export function byMeterProvider(factory) {
  let provider;
  let value;
  return () => {
    const current = metrics.getMeterProvider();
    if (current !== provider) {
      provider = current;
      value = factory(metrics.getMeter('browser-poc-metrics', '0.1.0'));
    }
    return value;
  };
}

const core = byMeterProvider((meter) => ({
  uiClicks: meter.createCounter('app.ui.clicks', { description: 'Button clicks in the demo UI' }),
  errorCount: meter.createCounter('browser.errors', { description: 'Unhandled errors and promise rejections' }),
  httpDuration: meter.createHistogram('browser.http.client.duration', {
    description: 'Duration of fetch/XHR calls made by the page',
    unit: 'ms',
    advice: { explicitBucketBoundaries: [25, 50, 100, 250, 500, 1000, 2500, 5000] },
  }),
  vitals: {
    LCP: meter.createHistogram('web_vital.lcp', { unit: 'ms', advice: { explicitBucketBoundaries: [500, 1000, 2500, 4000, 6000] } }),
    FCP: meter.createHistogram('web_vital.fcp', { unit: 'ms', advice: { explicitBucketBoundaries: [500, 1000, 1800, 3000, 5000] } }),
    TTFB: meter.createHistogram('web_vital.ttfb', { unit: 'ms', advice: { explicitBucketBoundaries: [100, 200, 800, 1800, 3000] } }),
    INP: meter.createHistogram('web_vital.inp', { unit: 'ms', advice: { explicitBucketBoundaries: [50, 200, 500, 1000] } }),
    CLS: meter.createHistogram('web_vital.cls', { advice: { explicitBucketBoundaries: [0.05, 0.1, 0.25, 0.5] } }),
  },
}));

export const uiClicks = { add: (v, attrs) => core().uiClicks.add(v, attrs) };
export const errorCount = { add: (v, attrs) => core().errorCount.add(v, attrs) };
export function recordVital(metric) {
  core().vitals[metric.name]?.record(metric.value, { 'web_vital.rating': metric.rating });
}

// ---- RED metrics derived from spans -----------------------------------------
// Every finished fetch/XHR span also records a duration. Attributes stay LOW cardinality: host + method + status.
const HTTP_SCOPES = ['@opentelemetry/instrumentation-fetch', '@opentelemetry/instrumentation-xml-http-request'];
export class HttpMetricsSpanProcessor {
  onStart() {}
  onEnd(span) {
    if (!HTTP_SCOPES.includes(span.instrumentationScope?.name)) return;
    const a = span.attributes;
    let host = a['server.address'] ?? a['http.host'];
    if (!host) {
      try { host = new URL(a['http.url'] ?? a['url.full']).host; } catch { host = 'unknown'; }
    }
    const [s, ns] = span.duration;
    core().httpDuration.record(s * 1000 + ns / 1e6, {
      'http.request.method': a['http.request.method'] ?? a['http.method'] ?? 'GET',
      'http.response.status_code': a['http.response.status_code'] ?? a['http.status_code'] ?? 0,
      'server.address': host,
    });
  }
  forceFlush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}

// ---- Logs --------------------------------------------------------------------
const logger = logs.getLogger('browser-poc-logs', '0.1.0');
const LEVELS = {
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};
export function log(level, body, attributes = {}) {
  logger.emit({ severityNumber: LEVELS[level], severityText: level.toUpperCase(), body, attributes });
}
// Errors: keep type + message only (no stack trace, same privacy rule as spans)
export function logError(body, err, attributes = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  log('error', body, { ...attributes, 'exception.type': e.name, 'exception.message': e.message.slice(0, 200) });
}
