// Small backend (no framework). Spans are created automatically by HttpInstrumentation
// (server span "GET /api/hello" linked to the browser's trace) plus one manual child span.
const http = require('node:http');
const { trace } = require('@opentelemetry/api');

const tracer = trace.getTracer('backend-poc-app');

const server = http.createServer(async (req, res) => {
  // CORS: the browser must be allowed to send the `traceparent` header
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Headers', 'traceparent, tracestate, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const traceparent = req.headers['traceparent'] || null;
  console.log(`[backend] ${req.method} ${req.url}  traceparent=${traceparent}`);

  // Manual child span simulating a database call (shows backend work inside the same trace)
  await tracer.startActiveSpan('db.query.simulated', async (span) => {
    span.setAttribute('db.system', 'demo');
    await new Promise((r) => setTimeout(r, 80));
    span.end();
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'hello from backend', receivedTraceparent: traceparent }));
});

server.listen(3000, () => console.log('[backend] listening on http://localhost:3000'));
