// A webhook receiver that does the three things receivers most often get wrong:
// verifies the signature, rejects replays, and processes each delivery once.

import http from 'http';
import { HEADERS, verify } from './signature.js';

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => resolve(data));
  req.on('error', reject);
});

// handler(event, id) does the real work. If it throws, the delivery is answered
// with 500 and NOT marked as processed, so the sender's retry can succeed later.
export function createReceiver({ secret, handler, nowMs = () => Date.now(), toleranceSec = 300 }) {
  const processed = new Map(); // delivery id -> time processed
  // Without this, two copies of one delivery arriving together would both pass the
  // "already processed?" check before either finished, and the event would run twice.
  const inFlight = new Set();

  const listener = async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' });

    const body = await readBody(req);
    const check = verify({
      secret,
      body,
      timestamp: req.headers[HEADERS.timestamp],
      signature: req.headers[HEADERS.signature],
      nowMs: nowMs(),
      toleranceSec,
    });
    if (!check.ok) return send(res, 401, { error: check.reason });

    const id = req.headers[HEADERS.id];
    if (!id) return send(res, 400, { error: 'missing-delivery-id' });
    if (processed.has(id)) return send(res, 200, { status: 'duplicate' });

    let event;
    try { event = JSON.parse(body); } catch { return send(res, 400, { error: 'invalid-json' }); }

    if (inFlight.has(id)) return send(res, 409, { error: 'in-progress' });
    inFlight.add(id);
    try {
      await handler(event, id);
    } catch {
      return send(res, 500, { error: 'handler-failed' });
    } finally {
      inFlight.delete(id);
    }
    processed.set(id, nowMs());
    return send(res, 200, { status: 'processed' });
  };

  return { listener, processed };
}

// Starts the receiver on a free port. Returns { url, close }.
export function startServer(listener, port = 0) {
  const server = http.createServer(listener);
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      // address() is a string for pipe/socket listeners; this server always listens on TCP.
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      resolve({ url: `http://127.0.0.1:${actual}/webhooks`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
