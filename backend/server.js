// Tiny backend (no dependencies) used to prove trace-context propagation.
// It only PRINTS the incoming `traceparent` header; the format is:
//   00-<trace-id>-<parent-span-id>-<flags>
// Compare the trace-id with the one shown in SigNoz / browser console.
import http from 'node:http';

const server = http.createServer((req, res) => {
  // CORS: the browser must be allowed to send the `traceparent` header
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Headers', 'traceparent, tracestate, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const traceparent = req.headers['traceparent'] || null;
  console.log(`[backend] ${req.method} ${req.url}  traceparent=${traceparent}`);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'hello from backend', receivedTraceparent: traceparent }));
});

server.listen(3000, () => console.log('[backend] listening on http://localhost:3000'));
