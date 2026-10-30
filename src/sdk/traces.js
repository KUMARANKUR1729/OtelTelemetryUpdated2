import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import {
  BatchSpanProcessor, SimpleSpanProcessor, ConsoleSpanExporter, ParentBasedSampler, TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ZoneContextManager } from '@opentelemetry/context-zone'; // importing this loads zone.js: that is why this file is lazy
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { UserInteractionInstrumentation } from '@opentelemetry/instrumentation-user-interaction';
import { trace, context, propagation } from '@opentelemetry/api';
import { HttpMetricsSpanProcessor } from '../instruments.js';
import { getSessionId } from './session.js';

// ---- PII scrubbing: strip query strings / fragments from URL attributes -----
const URL_ATTRS = ['http.url', 'url.full', 'http.target', 'url.query', 'url.path'];
const stripQuery = (v) => (typeof v === 'string' ? v.replace(/[?#].*$/, '') : v);

class RedactingExporter {
  constructor(inner) { this.inner = inner; }
  export(spans, resultCallback) {
    for (const span of spans) {
      for (const key of URL_ATTRS) {
        if (key in span.attributes) span.attributes[key] = stripQuery(span.attributes[key]);
      }
      // Exception messages can contain user data: keep type, truncate message, drop stack trace
      for (const ev of span.events || []) {
        const msg = ev.attributes?.['exception.message'];
        if (typeof msg === 'string') ev.attributes['exception.message'] = msg.slice(0, 200);
        if (ev.attributes?.['exception.stacktrace']) delete ev.attributes['exception.stacktrace'];
      }
    }
    this.inner.export(spans, resultCallback);
  }
  shutdown() { return this.inner.shutdown(); }
  forceFlush() { return this.inner.forceFlush?.() ?? Promise.resolve(); }
}

class SessionSpanProcessor {
  constructor(id) { this.id = id; }
  onStart(span) { span.setAttribute('session.id', this.id); }
  onEnd() {}
  forceFlush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}

export function startTraces(config, resource) {
  const processors = [new SessionSpanProcessor(getSessionId())];
  if (config.signals.metrics) processors.push(new HttpMetricsSpanProcessor()); // needs the metrics signal too
  processors.push(
    new BatchSpanProcessor(new RedactingExporter(new OTLPTraceExporter({ url: `${config.otlpBase}/v1/traces` })), {
      maxQueueSize: 100, maxExportBatchSize: 30, scheduledDelayMillis: 2000,
    }),
  );
  if (config.consoleDebug) processors.unshift(new SimpleSpanProcessor(new ConsoleSpanExporter()));

  const provider = new WebTracerProvider({
    resource,
    // ParentBased: if a parent decided to sample, children follow; otherwise sample by ratio
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRatio) }),
    spanProcessors: processors,
  });
  // ZoneContextManager keeps the "current span" across promises/timeouts (NOT across native async/await).
  provider.register({ contextManager: new ZoneContextManager() });

  const f = config.features;
  const instrumentations = [];
  if (f.documentLoad) instrumentations.push(new DocumentLoadInstrumentation());
  if (f.userInteraction) instrumentations.push(new UserInteractionInstrumentation());
  if (f.fetch) {
    instrumentations.push(new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: config.propagateTo, ignoreUrls: config.ignoreUrls, clearTimingResources: true,
    }));
  }
  if (f.xhr) {
    instrumentations.push(new XMLHttpRequestInstrumentation({
      propagateTraceHeaderCorsUrls: config.propagateTo, ignoreUrls: config.ignoreUrls,
    }));
  }
  // Instrumentations enable themselves (patch fetch/XHR/etc.) when constructed, i.e. only now that telemetry is on.
  // stop() calls disable() on each one, which restores the original fetch/XHR.

  return {
    flush: () => provider.forceFlush(),
    stop: async () => {
      instrumentations.forEach((i) => i.disable());
      await provider.shutdown();
      trace.disable(); context.disable(); propagation.disable(); // allow a clean re-start later
    },
  };
}
