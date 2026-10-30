// Telemetry configuration. Everything is OFF unless explicitly switched on.
// Order of precedence (last wins): built-in defaults < .env (VITE_OTEL_*) < options passed to initTelemetry().
// This file imports NO OpenTelemetry packages, so it is free to load when telemetry is disabled.

const env = import.meta.env;

export const SIGNALS = ['traces', 'metrics', 'logs'];
export const FEATURES = ['documentLoad', 'userInteraction', 'fetch', 'xhr', 'webVitals', 'errors', 'consoleCapture'];
export const CONSENT_KEY = 'otel.consent'; // localStorage value: 'granted' | 'denied'

const parseBool = (v, d) =>
  v === undefined || v === '' ? d : ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase());
const parseNum = (v, d) => {
  const n = Number(v);
  return v === undefined || v === '' || Number.isNaN(n) ? d : n;
};
const parseList = (v) =>
  v === undefined || v === '' ? null : String(v).split(',').map((s) => s.trim()).filter(Boolean);
// "traces,logs" -> { traces: true, metrics: false, logs: true } (only when the variable is set)
const flagsFromList = (all, list) => (list ? Object.fromEntries(all.map((k) => [k, list.includes(k)])) : {});
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toRegExps = (items) => items.map((i) => (i instanceof RegExp ? i : new RegExp(escapeRegExp(String(i)))));

export const DEFAULTS = {
  enabled: false,          // master switch: nothing is loaded, patched, stored or sent while false
  requireConsent: false,   // true: also wait for grantConsent() (stored in localStorage) before starting
  otlpBase: 'http://localhost:4318',
  environment: 'local',
  serviceName: 'browser-poc',
  serviceVersion: '0.3.0',
  signals: { traces: true, metrics: true, logs: true },       // only used once enabled
  features: {                                                  // only used once enabled
    documentLoad: true, userInteraction: true, fetch: true, xhr: true,
    webVitals: true, errors: true, consoleCapture: true,
  },
  sampleRatio: 1,
  propagateTo: ['localhost:3000'], // origins that receive the `traceparent` header
  ignoreUrls: [],                  // the collector URL is always ignored automatically
  metricsIntervalMs: 10_000,
  consoleDebug: false,             // also print spans/logs to the browser console
};

export function resolveConfig(overrides = {}) {
  const base = resolveBase();
  const o = overrides || {};
  const otlpBase = String(o.otlpBase ?? base.otlpBase).replace(/\/$/, '');
  const cfg = {
    ...base,
    ...o,
    otlpBase,
    signals: { ...base.signals, ...(o.signals || {}) },
    features: { ...base.features, ...(o.features || {}) },
  };
  cfg.sampleRatio = Math.min(1, Math.max(0, Number(cfg.sampleRatio)));
  if (Number.isNaN(cfg.sampleRatio)) cfg.sampleRatio = 1;
  cfg.propagateTo = toRegExps(cfg.propagateTo);
  cfg.ignoreUrls = toRegExps([...cfg.ignoreUrls, otlpBase]); // never trace the telemetry export itself
  return cfg;
}

function resolveBase() {
  const legacyUrl = (env.VITE_OTLP_URL || '').replace(/\/v1\/traces\/?$/, '');
  const features = flagsFromList(FEATURES, parseList(env.VITE_OTEL_FEATURES));
  if (env.VITE_CAPTURE_CONSOLE !== undefined) features.consoleCapture ??= parseBool(env.VITE_CAPTURE_CONSOLE, true); // legacy name
  return {
    ...DEFAULTS,
    enabled: parseBool(env.VITE_OTEL_ENABLED, DEFAULTS.enabled),
    requireConsent: parseBool(env.VITE_OTEL_REQUIRE_CONSENT, DEFAULTS.requireConsent),
    otlpBase: env.VITE_OTLP_BASE_URL || legacyUrl || DEFAULTS.otlpBase,
    environment: env.VITE_ENV || DEFAULTS.environment,
    sampleRatio: parseNum(env.VITE_SAMPLE_RATIO, DEFAULTS.sampleRatio),
    propagateTo: parseList(env.VITE_OTEL_PROPAGATE_TO) ?? DEFAULTS.propagateTo,
    ignoreUrls: parseList(env.VITE_OTEL_IGNORE_URLS) ?? DEFAULTS.ignoreUrls,
    metricsIntervalMs: parseNum(env.VITE_OTEL_METRICS_INTERVAL_MS, DEFAULTS.metricsIntervalMs),
    consoleDebug: parseBool(env.VITE_CONSOLE_SPANS, DEFAULTS.consoleDebug),
    signals: { ...DEFAULTS.signals, ...flagsFromList(SIGNALS, parseList(env.VITE_OTEL_SIGNALS)) },
    features: { ...DEFAULTS.features, ...features },
  };
}

// ---- Consent storage (works even if localStorage is blocked) -----------------
let memoryConsent = null;
export function readConsent() {
  try { return localStorage.getItem(CONSENT_KEY) ?? memoryConsent; } catch { return memoryConsent; }
}
export function writeConsent(value) {
  memoryConsent = value;
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* blocked: in-memory only */ }
}
