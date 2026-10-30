// Starts the signals/features the config allows and returns one stop() function that undoes all of it.
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { log } from '../instruments.js';

export async function startSdk(config) {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: config.serviceVersion,
    'deployment.environment.name': config.environment, // current semantic convention
    'deployment.environment': config.environment,      // older name; SigNoz groups by this one
  });
  const handles = []; // each: { flush(), stop() }

  const stopAll = async () => {
    document.removeEventListener('visibilitychange', onHide);
    for (const h of handles.reverse()) { try { await h.stop(); } catch { /* keep stopping the rest */ } }
  };
  const flushAll = () => Promise.allSettled(handles.map((h) => h.flush?.()));
  const onHide = () => { if (document.visibilityState === 'hidden') flushAll(); };

  try {
    const { signals, features } = config;
    // Order matters: logs and metrics first, so spans/errors created later can already use them.
    if (signals.logs) handles.push((await import('./logs.js')).startLogs(config, resource));
    if (signals.metrics) handles.push((await import('./metrics.js')).startMetrics(config, resource));
    if (signals.traces) handles.push((await import('./traces.js')).startTraces(config, resource));
    if (features.consoleCapture && signals.logs) handles.push((await import('./logs.js')).startConsoleCapture());
    if (features.errors || features.webVitals) handles.push(await (await import('./browser-events.js')).startBrowserEvents(config));
  } catch (e) {
    await stopAll();
    throw e;
  }

  document.addEventListener('visibilitychange', onHide); // flush when the user leaves/hides the page
  log('info', 'telemetry initialised', { 'telemetry.signals': enabledSignals(config).join(',') });
  if (config.consoleDebug) console.info('[otel] telemetry started ->', config.otlpBase);

  return async () => { await flushAll(); await stopAll(); };
}

const enabledSignals = (c) => Object.keys(c.signals).filter((k) => c.signals[k]);
