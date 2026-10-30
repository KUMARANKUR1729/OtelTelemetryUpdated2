// The ONLY entry point app code needs. Cheap to import: it pulls in no OpenTelemetry SDK code.
// The SDK (src/sdk/*) is loaded with dynamic import() only after telemetry is switched on, so while it is off:
//   no SDK bytes downloaded, fetch/XHR not patched, zone.js not loaded, no storage written, no network requests.
import { resolveConfig, readConsent, writeConsent } from './config.js';

const state = { status: 'off', reason: 'not initialised', config: null, stop: null };
const listeners = new Set();
let queue = Promise.resolve(); // start/stop calls run one at a time

function setStatus(status, reason = '') {
  state.status = status; // 'off' | 'waiting-consent' | 'starting' | 'on'
  state.reason = reason;
  const snapshot = getTelemetryStatus();
  listeners.forEach((fn) => { try { fn(snapshot); } catch { /* listener errors must not break telemetry */ } });
}
const serialise = (fn) => (queue = queue.then(fn, fn).catch((e) => console.warn('[otel] telemetry error:', e?.message ?? e)));

export function getTelemetryStatus() {
  const c = state.config;
  return {
    status: state.status,
    reason: state.reason,
    enabled: !!c?.enabled,
    requireConsent: !!c?.requireConsent,
    consent: readConsent(),
    signals: c ? Object.keys(c.signals).filter((k) => c.signals[k]) : [],
  };
}
export function onTelemetryStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call once at app start. Safe to call with no arguments: telemetry then stays off unless .env opts in. */
export function initTelemetry(options = {}) {
  return serialise(async () => {
    await stopNow(); // allows re-init with new options
    const config = resolveConfig(options);
    state.config = config;
    if (!config.enabled) return setStatus('off', 'disabled by configuration (opt-in: set VITE_OTEL_ENABLED=true or pass { enabled: true })');
    if (!SIGNALS_ON(config)) return setStatus('off', 'every signal is switched off');
    if (config.requireConsent && readConsent() !== 'granted') return setStatus('waiting-consent', 'waiting for user consent');
    await startNow();
  });
}

/** User said yes. Starts telemetry if the config allows it (and remembers the choice). */
export function grantConsent() {
  writeConsent('granted');
  return serialise(async () => {
    if (state.config?.enabled && SIGNALS_ON(state.config) && state.status !== 'on') await startNow();
    else setStatus(state.status, state.reason); // notify listeners about the consent change
  });
}

/** User said no / withdrew consent. Flushes nothing more than already queued, stops everything, forgets nothing else. */
export function revokeConsent() {
  writeConsent('denied');
  return serialise(async () => {
    await stopNow();
    if (state.config?.enabled) setStatus(state.config.requireConsent ? 'waiting-consent' : 'off', 'consent withdrawn');
  });
}

/** Developer-side kill switch (e.g. for tests or a settings page). Does not change stored consent. */
export function stopTelemetry() {
  return serialise(async () => { await stopNow(); setStatus('off', 'stopped'); });
}

const SIGNALS_ON = (c) => Object.values(c.signals).some(Boolean);

async function startNow() {
  setStatus('starting');
  try {
    const { startSdk } = await import('./sdk/index.js');
    state.stop = await startSdk(state.config);
    setStatus('on');
  } catch (e) {
    state.stop = null;
    setStatus('off', `failed to start: ${e?.message ?? e}`);
  }
}
async function stopNow() {
  const stop = state.stop;
  state.stop = null;
  if (stop) await stop();
}
