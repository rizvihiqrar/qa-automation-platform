// Incident game day (A100): a live drill, not a test.
//
//   npm run game-day            starts Postgres, Toxiproxy, the API and steady traffic
//   npm run game-day -- cut     (incident commander) cut the line from the API to Postgres
//   npm run game-day -- restore (incident commander) put the line back
//   npm run game-day -- note "text"  (responder) a note in responder.log, in the same clock as the other logs
//   npm run game-day -- stop    stop everything and remove the containers
//
// Two people play it. The incident commander cuts and restores the line and does not
// say when. The responder only has what an on-call person has: the pager, the
// traffic log (what a dashboard would show), the API's own log and the Toxiproxy
// control API. The commander's `cut` and `restore` go to ground-truth.log, which
// the responder does not read until the postmortem. Everything is under
// reports/game-day (git-ignored). Needs Docker running.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { Network } from 'testcontainers';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { ToxiProxyContainer } from '@testcontainers/toxiproxy';
import { Pager } from './pager.ts';

// The same tags as scripts/with-postgres.ts (not imported: that file starts the containers
// when loaded; tests/game-day.spec.ts checks they match).
export const POSTGRES_IMAGE = 'postgres:17-alpine';
export const TOXIPROXY_IMAGE = 'ghcr.io/shopify/toxiproxy:2.12.0';

const DIR = 'reports/game-day';
const STATE = `${DIR}/state.json`;
const STOP = `${DIR}/stop`;
const PORT = 4100;
const API = `http://127.0.0.1:${PORT}`;
const TICK_MS = 1000;
const ADMIN = { email: 'admin@game-day.test', password: 'Game-day-admin-1!' };

const stamp = () => new Date().toISOString().slice(11, 23);
const log = (file: string, line: string, at = stamp()) => appendFileSync(`${DIR}/${file}`, `${at} ${line}\n`);
const running = () => {
  if (!existsSync(STATE)) return false;
  try {
    process.kill(JSON.parse(readFileSync(STATE, 'utf8')).pid, 0); // throws when that process is gone
    return true;
  } catch {
    return false;
  }
};

async function control(action: 'cut' | 'restore') {
  if (!running()) throw new Error('No game day is running (npm run game-day first)');
  const { toxiproxy } = JSON.parse(readFileSync(STATE, 'utf8'));
  const at = stamp(); // when the commander acted, not when Toxiproxy answered
  const res = await fetch(`${toxiproxy}/proxies/game-day`, { method: 'POST', body: JSON.stringify({ enabled: action === 'restore' }) });
  if (!res.ok) throw new Error(`Toxiproxy answered ${res.status}`);
  log('ground-truth.log', `COMMANDER ${action}`, at);
  console.log(`line ${action === 'cut' ? 'cut' : 'restored'}`);
}

const mode = process.argv[2];
if (mode === 'cut' || mode === 'restore') {
  await control(mode);
  process.exit(0);
}
if (mode === 'note') {
  const words = process.argv.slice(3).join(' ');
  if (!words) throw new Error('usage: npm run game-day -- note "what you did or saw"');
  mkdirSync(DIR, { recursive: true });
  log('responder.log', words);
  process.exit(0);
}
if (mode === 'stop') {
  if (!running()) throw new Error('No game day is running');
  writeFileSync(STOP, '');
  console.log('stopping...');
  process.exit(0);
}
if (mode) {
  console.error('usage: npm run game-day [-- cut | restore | note "text" | stop]');
  process.exit(2);
}

// A second start would delete the first one's logs while its containers keep running.
if (running()) throw new Error('A game day is already running (npm run game-day -- stop first)');
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
console.log(`Starting ${POSTGRES_IMAGE} and ${TOXIPROXY_IMAGE}...`);
const network = await new Network().start();
const [postgres, toxiproxy] = await Promise.all([
  new PostgreSqlContainer(POSTGRES_IMAGE).withNetwork(network).withNetworkAliases('postgres').start(),
  new ToxiProxyContainer(TOXIPROXY_IMAGE).withNetwork(network).start(),
]);
const proxy = await toxiproxy.createProxy({ name: 'game-day', upstream: 'postgres:5432' });
const url = new URL(postgres.getConnectionUri());
url.hostname = proxy.host;
url.port = String(proxy.port);

const logFile = openSync(`${DIR}/api.log`, 'a');
const server = spawn(process.execPath, ['src/server.ts'], {
  stdio: ['ignore', logFile, logFile],
  env: { ...process.env, PORT: String(PORT), DATABASE_URL: url.href, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password },
});

let closed = false;
async function shutdown() {
  if (closed) return;
  closed = true;
  rmSync(STATE, { force: true }); // so cut and restore don't act on a dead address
  server.kill();
  await Promise.allSettled([postgres.stop(), toxiproxy.stop()]);
  await network.stop();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void shutdown().then(() => process.exit(0)));

const call = async (path: string, init: RequestInit = {}) => {
  try {
    const res = await fetch(`${API}${path}`, { ...init, signal: AbortSignal.timeout(4000) });
    return { status: res.status, body: await res.json().catch(() => ({})) as any };
  } catch {
    return { status: 0, body: {} as any }; // no answer in time
  }
};
const json = (headers: Record<string, string>, data: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });

// Wait for the API, then set up a shop to order from.
let up = false;
for (let i = 0; i < 150 && !up; i++) up = (await call('/health/ready')).status === 200 || (await sleep(200), false);
const login = await call('/auth/login', json({}, ADMIN));
const adminAuth = { Authorization: `Bearer ${login.body.token}` };
const product = await call('/products', json(adminAuth, { name: 'Game day mug', price: 9.5, stock: 1_000_000, category: 'game-day' }));
const customer = await call('/auth/register', json({}, { name: 'Customer', email: `customer@game-day.test`, password: 'Pass123!' }));
const customerAuth = { Authorization: `Bearer ${customer.body.token}` };
if (!up || !product.body.id || !customer.body.token) {
  await shutdown(); // nothing else would remove the containers
  throw new Error(`Could not set up the shop: API up ${up}, login ${login.status}, product ${product.status}, customer ${customer.status}`);
}

writeFileSync(STATE, JSON.stringify({ api: API, toxiproxy: `http://${toxiproxy.getHost()}:${toxiproxy.getMappedPort(8474)}`, pid: process.pid }));
console.log(`Up. API ${API}, traffic log ${DIR}/traffic.log, pager ${DIR}/pager.log, API log ${DIR}/api.log`);
log('traffic.log', 'time ready products order-placed');

// Each tick: the readiness check, a read and an order (a write).
const pager = new Pager();
// A tick lasts as long as its slowest call (up to 4 s on a slow line) plus the pause.
try {
  while (!existsSync(STOP)) {
    const [ready, products, order] = await Promise.all([
      call('/health/ready'),
      call('/products'),
      call('/orders', json(customerAuth, { items: [{ product_id: product.body.id, quantity: 1 }] })),
    ]);
    log('traffic.log', `ready=${ready.status} products=${products.status} order=${order.status}`);
    const event = pager.check(ready.status === 200);
    if (event === 'page') log('pager.log', 'PAGE  /health/ready failed 3 checks in a row');
    if (event === 'resolve') log('pager.log', 'RESOLVED  /health/ready answered 3 checks in a row');
    await sleep(TICK_MS);
  }
} finally {
  await shutdown(); // also after a crash in the loop, or the containers would stay
}
