// Backend OpenTelemetry bootstrap, loaded BEFORE the app via `node -r ./backend/tracing.cjs`.
// OPT-IN: nothing is loaded or exported unless OTEL_ENABLED=true.
//
//   OTEL_ENABLED=true          master switch (default: false)
//   OTEL_TRACES_ENABLED=true   traces on/off once enabled (default: true)
//   OTEL_SAMPLE_RATIO=1        0..1, parent-based (default: 1)
//   OTEL_SERVICE_NAME          default: backend-poc
//   OTEL_ENVIRONMENT           default: local
//   OTLP_URL                   default: http://localhost:4318/v1/traces
const flag = (v, d) => (v === undefined || v === '' ? d : ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase()));

if (!flag(process.env.OTEL_ENABLED, false)) {
  console.log('[otel] backend telemetry is OFF (opt in with OTEL_ENABLED=true)');
  return; // CommonJS: stops here, so the SDK packages are never even loaded
}
if (!flag(process.env.OTEL_TRACES_ENABLED, true)) {
  console.log('[otel] backend telemetry is ON but traces are switched off: nothing to export');
  return;
}

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ParentBasedSampler, TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace-base');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

const ratio = Math.min(1, Math.max(0, Number(process.env.OTEL_SAMPLE_RATIO ?? 1)));
const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'backend-poc',
    'deployment.environment.name': process.env.OTEL_ENVIRONMENT || 'local',
    'deployment.environment': process.env.OTEL_ENVIRONMENT || 'local', // SigNoz groups by this older name
  }),
  traceExporter: new OTLPTraceExporter({ url: process.env.OTLP_URL || 'http://localhost:4318/v1/traces' }),
  sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(Number.isNaN(ratio) ? 1 : ratio) }),
  instrumentations: [new HttpInstrumentation()],
});
sdk.start();
console.log('[otel] backend telemetry is ON (traces)');

// Flush remaining spans on shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => sdk.shutdown().finally(() => process.exit(0)));
}
