import { trace, metrics, context, SpanStatusCode } from '@opentelemetry/api';
import { initTelemetry, grantConsent, revokeConsent, onTelemetryStatus } from './telemetry.js';
import { log, logError, uiClicks, byMeterProvider } from './instruments.js';

// Telemetry is OFF unless .env opts in (VITE_OTEL_ENABLED=true). Without it, everything below still works:
// the OpenTelemetry API calls are no-ops. Await this before your first request if you must not miss it.
initTelemetry();

const tracer = trace.getTracer('browser-poc-app', '0.1.0');
const out = document.querySelector('#out');
const show = (msg) => (out.textContent = msg);

// 1. Public API call: auto-traced by FetchInstrumentation (no traceparent sent: origin not in allow-list)
document.querySelector('#btn-public').onclick = async () => {
  const res = await fetch('https://jsonplaceholder.typicode.com/todos/1');
  show('Public API -> ' + JSON.stringify(await res.json(), null, 2));
};

// 2. Own backend: traceparent header IS injected, so backend logs the same trace ID
document.querySelector('#btn-backend').onclick = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/hello');
    show('Backend -> ' + JSON.stringify(await res.json(), null, 2));
  } catch (e) {
    show('Backend not running? Start it with: npm run backend\n' + e.message);
  }
};

// 3. XHR: auto-traced by XMLHttpRequestInstrumentation
document.querySelector('#btn-xhr').onclick = () => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'https://jsonplaceholder.typicode.com/users/1');
  xhr.onload = () => show('XHR -> status ' + xhr.status);
  xhr.send();
};

// 4. Manual span with attributes, events and a nested child span.
// NOTE: zone.js cannot track native async/await, so the parent context is captured
// BEFORE the first await and passed explicitly to the child span.
document.querySelector('#btn-custom').onclick = () => {
  tracer.startActiveSpan('checkout.submit', async (span) => {
    const parentCtx = trace.setSpan(context.active(), span);

    span.setAttribute('cart.items', 3);
    span.setAttribute('user.tier', 'demo');
    span.addEvent('validation.started');
    await new Promise((r) => setTimeout(r, 200));

    await tracer.startActiveSpan('checkout.payment', {}, parentCtx, async (child) => {
      await new Promise((r) => setTimeout(r, 300));
      child.end();
    });

    span.addEvent('validation.finished');
    span.end();
    show('Custom span "checkout.submit" (+ child "checkout.payment") created.');
  });
};

// 5. Error span: record the exception and mark the span as failed
document.querySelector('#btn-error').onclick = () => {
  tracer.startActiveSpan('risky.operation', (span) => {
    try {
      throw new Error('Simulated failure');
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      show('Error span "risky.operation" recorded.');
    } finally {
      span.end();
    }
  });
};

// 6. Unhandled error: caught by the global window.onerror hook in tracing.js
document.querySelector('#btn-unhandled').onclick = () => {
  show('Throwing an unhandled error... look for "browser.error" in SigNoz.');
  setTimeout(() => { throw new Error('Unhandled demo error'); }, 0);
};

// Count every demo-button click (metric attribute = which button; low cardinality)
document.querySelectorAll('button').forEach((b) =>
  b.addEventListener('click', () => uiClicks.add(1, { button: b.id }))
);

// 7. Logs: records emitted INSIDE a span automatically carry its trace_id/span_id,
// so in Grafana you can go from the log line to the trace. The last one is outside any span.
document.querySelector('#btn-logs').onclick = () => {
  tracer.startActiveSpan('logs.demo', (span) => {
    log('info', 'user opened the logs demo', { 'demo.step': 1 });
    log('warn', 'payment provider slow, retrying', { 'demo.step': 2, 'retry.attempt': 1 });
    logError('payment failed for user jane.doe@example.com', new Error('card declined'), { 'demo.step': 3 });
    span.end();
  });
  log('info', 'log outside any span (no trace id)');
  console.warn('console.warn is captured as a log record too');
  show('Logs sent: 3 inside a span (same trace id) + 1 outside + 1 console.warn.\nThe e-mail address is redacted before export.');
};

// 8. Custom metrics: a business counter and a histogram with attributes
// Instruments are created lazily (byMeterProvider) because the metrics API cannot hand out working meters before the SDK starts.
const orderMetrics = byMeterProvider(() => {
  const meter = metrics.getMeter('browser-poc-app', '0.1.0');
  return {
    orders: meter.createCounter('app.orders.completed', { description: 'Completed checkouts' }),
    orderValue: meter.createHistogram('app.order.value', { unit: 'USD', advice: { explicitBucketBoundaries: [10, 25, 50, 100, 250, 500] } }),
  };
});
document.querySelector('#btn-metrics').onclick = () => {
  const value = Math.round(5 + Math.random() * 400);
  const tier = value > 100 ? 'large' : 'small'; // low-cardinality attribute (never user ids / emails)
  const { orders, orderValue } = orderMetrics();
  orders.add(1, { tier });
  orderValue.record(value, { tier });
  show(`Recorded order: ${value} USD (${tier}). Metrics are exported every 10 s.`);
};

// ---- Telemetry status + consent panel ---------------------------------------
const statusEl = document.querySelector('#tel-status');
const yesBtn = document.querySelector('#btn-consent-yes');
const noBtn = document.querySelector('#btn-consent-no');
onTelemetryStatus((s) => {
  const label = {
    off: 'OFF',
    'waiting-consent': 'OFF (waiting for your consent)',
    starting: 'starting...',
    on: `ON (${s.signals.join(', ')})`,
  }[s.status];
  statusEl.textContent = `Telemetry: ${label}${s.status === 'off' && s.reason ? ' - ' + s.reason : ''}`;
  const usesConsent = s.enabled && s.requireConsent;
  yesBtn.hidden = noBtn.hidden = !usesConsent;
  yesBtn.disabled = s.consent === 'granted';
  noBtn.disabled = s.consent !== 'granted';
});
yesBtn.onclick = () => grantConsent();
noBtn.onclick = () => revokeConsent();
