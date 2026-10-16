#!/usr/bin/env node
// Runs the receiver locally and sends it six deliveries that cover the cases a
// webhook receiver must handle. Prints what happened to each.

import { createReceiver, startServer } from './receiver.js';
import { deliver } from './sender.js';
import { HEADERS, sign } from './signature.js';

const SECRET = 'demo-secret';
let failuresLeft = 2;
const handled = [];
const { listener } = createReceiver({
  secret: SECRET,
  handler: (event) => {
    if (event.type === 'order.flaky' && failuresLeft-- > 0) throw new Error('database busy');
    handled.push(event.type);
  },
});
const { url, close } = await startServer(listener);
const noWait = () => Promise.resolve();

const raw = async (headers, body) => (await fetch(url, { method: 'POST', headers, body })).status;
const now = () => Math.floor(Date.now() / 1000);
const rows = [];

const first = await deliver({ url, secret: SECRET, event: { type: 'order.created' }, id: 'evt-1', sleep: noWait });
rows.push(['Valid delivery', `delivered after ${first.attempts.length} attempt(s)`]);

const again = await deliver({ url, secret: SECRET, event: { type: 'order.created' }, id: 'evt-1', sleep: noWait });
rows.push(['Same delivery id sent again', again.delivered ? 'accepted as duplicate, not processed twice' : 'failed']);

const flaky = await deliver({ url, secret: SECRET, event: { type: 'order.flaky' }, id: 'evt-2', sleep: noWait });
rows.push(['Handler fails twice, then works', `delivered after ${flaky.attempts.length} attempts (${flaky.attempts.map((a) => a.status).join(', ')})`]);

const body = JSON.stringify({ type: 'order.created', amount: 100 });
const ts = now();
const tampered = await raw({ [HEADERS.id]: 'evt-3', [HEADERS.timestamp]: String(ts), [HEADERS.signature]: sign(SECRET, ts, body) }, body.replace('100', '1'));
rows.push(['Body changed after signing', `rejected with ${tampered}`]);

const old = ts - 3600;
const replay = await raw({ [HEADERS.id]: 'evt-4', [HEADERS.timestamp]: String(old), [HEADERS.signature]: sign(SECRET, old, body) }, body);
rows.push(['Signed an hour ago (replay)', `rejected with ${replay}`]);

const wrong = await deliver({ url, secret: 'wrong-secret', event: { type: 'x' }, id: 'evt-5', sleep: noWait });
rows.push(['Wrong secret', `${wrong.reason} after ${wrong.attempts.length} attempt (no retry on 401)`]);

await close();
for (const [c, r] of rows) console.log(`${c.padEnd(34)} ${r}`);
console.log(`\nEvents processed: ${handled.join(', ')}`);
