// Global error tracking + Core Web Vitals. Each part follows its own feature switch and is removed on stop().
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { errorCount, recordVital, logError } from '../instruments.js';

export async function startBrowserEvents(config) {
  let active = true;
  const cleanups = [];

  if (config.features.errors) {
    const errTracer = trace.getTracer('browser-errors');
    const reportError = (name, err) => {
      if (!active) return;
      const e = err instanceof Error ? err : new Error(String(err));
      const span = errTracer.startSpan(name);
      span.recordException(e);
      span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
      span.end();
      errorCount.add(1, { 'error.kind': name });                       // metric: how many
      logError(`Unhandled: ${e.message}`, e, { 'error.kind': name }); // log: what
    };
    const onError = (ev) => reportError('browser.error', ev.error || ev.message);
    const onRejection = (ev) => reportError('browser.unhandledrejection', ev.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    cleanups.push(() => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    });
  }

  if (config.features.webVitals) {
    const { onLCP, onCLS, onINP, onFCP, onTTFB } = await import('web-vitals');
    const vitalsTracer = trace.getTracer('web-vitals');
    const reportVital = (metric) => {
      if (!active) return; // web-vitals has no unsubscribe: ignore late callbacks after stop()
      const span = vitalsTracer.startSpan(`web-vital.${metric.name}`);
      span.setAttribute('web_vital.name', metric.name);
      span.setAttribute('web_vital.value', metric.value);
      span.setAttribute('web_vital.rating', metric.rating);
      span.setAttribute('web_vital.id', metric.id);
      span.end();
      recordVital(metric); // same value as a histogram: percentiles/trends across all users
    };
    [onLCP, onCLS, onINP, onFCP, onTTFB].forEach((fn) => fn(reportVital));
  }

  return { stop: async () => { active = false; cleanups.forEach((fn) => fn()); } };
}
