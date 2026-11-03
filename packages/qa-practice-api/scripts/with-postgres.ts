// Runs a command with a fresh Postgres in Docker (Testcontainers) and DATABASE_URL
// pointing at it, then removes the containers:
//
//   npm run test:postgres                      the whole Playwright suite on Postgres
//   node scripts/with-postgres.ts npx playwright test tests/concurrency.spec.ts
//
// Toxiproxy (Day 51) starts next to it: a proxy the tests can tell to slow down,
// cut or silence the line to Postgres. DATABASE_URL is the direct line, so the
// main suite never sees a fault. TOXIPROXY_DATABASE_URLS lists lines through the
// proxy, postgres-0 to postgres-31, one per Playwright worker (a fault on one
// can't reach a test in another worker); TOXIPROXY_URL is the control API
// (tests/postgres/resilience.spec.ts).
//
// Needs Docker running. The images are pinned so a new release can't change the
// results without a commit; CI pulls the same tags first (scripts/postgres-ci.test.mjs).
import { spawnSync } from 'node:child_process';
import { Network } from 'testcontainers';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ToxiProxyContainer, type StartedToxiProxyContainer } from '@testcontainers/toxiproxy';

export const POSTGRES_IMAGE = 'postgres:17-alpine';
export const TOXIPROXY_IMAGE = 'ghcr.io/shopify/toxiproxy:2.12.0';
const PROXIES = 32; // every port the Toxiproxy container opens

const command = process.argv.slice(2);
if (!command.length) {
  console.error('usage: node scripts/with-postgres.ts <command> [args...]');
  process.exit(2);
}

console.log(`Starting ${POSTGRES_IMAGE} and ${TOXIPROXY_IMAGE}...`);
// A private Docker network, so Toxiproxy reaches Postgres by the name "postgres".
const network = await new Network().start();
const started = await Promise.allSettled([
  new PostgreSqlContainer(POSTGRES_IMAGE).withNetwork(network).withNetworkAliases('postgres').start(),
  new ToxiProxyContainer(TOXIPROXY_IMAGE).withNetwork(network).start(),
]);
// Everything that did start is stopped, even when something else failed: with
// Ryuk off (CI, burn-in) nothing else would remove it.
const stopAll = async () => {
  await Promise.allSettled(started.map((s) => (s.status === 'fulfilled' ? s.value.stop() : undefined)));
  await network.stop();
};
const failed = started.find((s) => s.status === 'rejected');
if (failed) {
  await stopAll();
  throw failed.reason;
}
const postgres = (started[0] as PromiseFulfilledResult<StartedPostgreSqlContainer>).value;
const toxiproxy = (started[1] as PromiseFulfilledResult<StartedToxiProxyContainer>).value;
try {
  // One at a time: createProxy picks the next free port.
  const throughProxy: string[] = [];
  for (let i = 0; i < PROXIES; i++) {
    const proxy = await toxiproxy.createProxy({ name: `postgres-${i}`, upstream: 'postgres:5432' });
    const url = new URL(postgres.getConnectionUri());
    url.hostname = proxy.host;
    url.port = String(proxy.port);
    throughProxy.push(url.href);
  }

  // One command string: npx needs a shell on Windows. Arguments with spaces or
  // quotes are quoted again, or the shell would split them (--grep "two words").
  const quote = (arg: string) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg);
  const result = spawnSync(command.map(quote).join(' '), {
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: postgres.getConnectionUri(),
      TOXIPROXY_DATABASE_URLS: throughProxy.join(' '),
      TOXIPROXY_URL: `http://${toxiproxy.getHost()}:${toxiproxy.getMappedPort(8474)}`,
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  await stopAll();
}
