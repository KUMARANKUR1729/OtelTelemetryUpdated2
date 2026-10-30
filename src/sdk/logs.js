import { logs } from '@opentelemetry/api-logs';
import { LoggerProvider, BatchLogRecordProcessor, SimpleLogRecordProcessor, ConsoleLogRecordExporter } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { log } from '../instruments.js';
import { getSessionId } from './session.js';

// Adds session.id and scrubs the body before the record is queued for export.
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const MAX_BODY = 500;
class SessionAndRedactProcessor {
  constructor(id) { this.id = id; }
  onEmit(record) {
    record.setAttribute('session.id', this.id);
    if (typeof record.body === 'string') record.setBody(record.body.replace(EMAIL, '[email]').slice(0, MAX_BODY));
  }
  forceFlush() { return Promise.resolve(); }
  shutdown() { return Promise.resolve(); }
}

export function startLogs(config, resource) {
  const processors = [
    new SessionAndRedactProcessor(getSessionId()), // must run before the exporting processor
    new BatchLogRecordProcessor(new OTLPLogExporter({ url: `${config.otlpBase}/v1/logs` }), {
      maxQueueSize: 200, maxExportBatchSize: 50, scheduledDelayMillis: 2000,
    }),
  ];
  if (config.consoleDebug) processors.push(new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()));
  const provider = new LoggerProvider({ resource, processors });
  logs.setGlobalLoggerProvider(provider);
  return {
    flush: () => provider.forceFlush(),
    stop: async () => { await provider.shutdown(); logs.disable(); },
  };
}

// Forward console.warn / console.error as log records. stop() puts the original console functions back.
export function startConsoleCapture() {
  let inside = false; // stops a loop if exporting itself ever prints to the console
  const originals = {};
  const wrappers = {};
  for (const level of ['warn', 'error']) {
    const original = console[level];
    originals[level] = original;
    wrappers[level] = (...args) => {
      original.apply(console, args);
      if (inside) return;
      inside = true;
      try {
        log(level, args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '), {
          'log.source': 'console',
        });
      } catch { /* never break the app because of logging */ } finally { inside = false; }
    };
    console[level] = wrappers[level];
  }
  return {
    stop: async () => {
      for (const level of Object.keys(originals)) {
        if (console[level] === wrappers[level]) console[level] = originals[level]; // don't clobber someone else's wrapper
      }
    },
  };
}
