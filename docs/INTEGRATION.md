# Integrating into a real app

The POC is framework-agnostic: all OpenTelemetry setup lives in `src/telemetry.js`, `src/config.js`, `src/instruments.js` and `src/sdk/`.
In a real app, copy those, then call `initTelemetry()` early in your entry point (telemetry stays off unless configured on; see CONFIGURATION.md).

## React (Vite / CRA)
```js
// src/main.jsx
import { initTelemetry } from './telemetry';
initTelemetry();                          // opt-in: off unless enabled by config
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')).render(<App />);
```
Error boundary -> span:
```jsx
import { trace, SpanStatusCode } from '@opentelemetry/api';
class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) {
    const span = trace.getTracer('react').startSpan('react.render.error');
    span.recordException(error);
    span.setAttribute('react.component_stack', (info.componentStack || '').slice(0, 500));
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  }
  render() { return this.state.failed ? <p>Something went wrong.</p> : this.props.children; }
}
```
Route-change spans (React Router v6):
```jsx
import { useLocation } from 'react-router-dom';
import { trace } from '@opentelemetry/api';
function RouteTracer() {
  const { pathname } = useLocation();               // use the route pattern, not raw ids, if possible
  React.useEffect(() => {
    const s = trace.getTracer('router').startSpan('route.change', { attributes: { 'route.path': pathname } });
    s.end();
  }, [pathname]);
  return null;
}
```

## Angular
Import `./tracing` at the top of `src/main.ts` before `bootstrapApplication` / `platformBrowserDynamic()`.
Angular already ships zone.js, so you do not need `@opentelemetry/context-zone`; use
`provider.register({ contextManager: new ZoneContextManager() })` only if it is not already loaded,
and make sure zone.js is imported first. Add a global ErrorHandler that creates a span like the
React error boundary above.

## Vue
Import `./tracing` first in `src/main.js`; use `app.config.errorHandler` to record exceptions as spans.

## Script-tag / no bundler
Bundle `telemetry.js` (and its lazy `sdk/` chunks) with Vite/esbuild and load it with `<script src>` before other scripts.

## Gotchas
- Native async/await loses the active span under zone.js. Capture the parent context before the first `await`
  and pass it explicitly (see button 4 in `src/main.js`).
- Add every API origin you control to `propagateTraceHeaderCorsUrls` AND allow the `traceparent`/`tracestate`
  headers in that API's CORS config. Do not add third-party origins.
- Content-Security-Policy: allow `connect-src` to your collector/gateway URL.
