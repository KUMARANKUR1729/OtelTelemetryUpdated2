import { metrics } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

export function startMetrics(config, resource) {
  const provider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${config.otlpBase}/v1/metrics` }),
        exportIntervalMillis: config.metricsIntervalMs, // POC: 10 s. Production: 30-60 s.
      }),
    ],
  });
  metrics.setGlobalMeterProvider(provider);
  return {
    flush: () => provider.forceFlush(),
    stop: async () => { await provider.shutdown(); metrics.disable(); },
  };
}
