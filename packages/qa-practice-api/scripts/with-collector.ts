// Runs a command with a real OpenTelemetry Collector pipeline in Docker (Testcontainers),
// then removes the containers:
//
//   npm run test:collector                     tests/collector against the pipeline
//   node scripts/with-collector.ts npx playwright test tests/collector
//
// Jaeger keeps the traces; the Collector (collector/config.yaml) receives the API's
// traces, logs and metrics, scrubs them, and sends traces to Jaeger and logs to a file
// in a temporary folder. The command gets:
//
//   COLLECTOR_URL        where the API sends OTLP (playwright.config.ts uses it)
//   COLLECTOR_HEALTH_URL the Collector's health check
//   JAEGER_URL           Jaeger's query API and UI
//   COLLECTOR_LOGS_FILE  the file the Collector writes log records to
//
// Needs Docker running. The images are pinned so a new release can't change the
// results without a commit; CI pulls the same tags first (scripts/collector-ci.test.mjs).
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Network, Wait } from 'testcontainers';

export const COLLECTOR_IMAGE = 'otel/opentelemetry-collector-contrib:0.141.0';
export const JAEGER_IMAGE = 'jaegertracing/jaeger:2.22.0';

const command = process.argv.slice(2);
if (!command.length) {
  console.error('usage: node scripts/with-collector.ts <command> [args...]');
  process.exit(2);
}

const config = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'collector', 'config.yaml');
// The Collector runs as a user of its own: it can only write to a folder everyone can.
const out = mkdtempSync(path.join(tmpdir(), 'collector-out-'));
chmodSync(out, 0o777);

console.log(`Starting ${JAEGER_IMAGE} and ${COLLECTOR_IMAGE}...`);
// A private Docker network, so the Collector reaches Jaeger by the name "jaeger".
const network = await new Network().start();
const started: { stop(): Promise<unknown> }[] = [];
const stopAll = async () => {
  await Promise.allSettled(started.map((c) => c.stop()));
  await network.stop();
  rmSync(out, { recursive: true, force: true });
};
// Ryuk is off in CI, so Ctrl+C or a CI timeout must clean up too, or the containers stay.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void stopAll().finally(() => process.exit(1)));
try {
  const jaeger = await new GenericContainer(JAEGER_IMAGE)
    .withNetwork(network).withNetworkAliases('jaeger')
    .withExposedPorts(16686)
    .withWaitStrategy(Wait.forHttp('/', 16686))
    .start();
  started.push(jaeger);
  const collector = await new GenericContainer(COLLECTOR_IMAGE)
    .withNetwork(network)
    .withExposedPorts(4318, 13133)
    .withCopyFilesToContainer([{ source: config, target: '/etc/otelcol-contrib/config.yaml' }])
    .withBindMounts([{ source: out, target: '/out', mode: 'rw' }])
    .withWaitStrategy(Wait.forHttp('/', 13133))
    .start();
  started.push(collector);

  // One command string: npx needs a shell on Windows. Arguments with spaces or
  // quotes are quoted again, or the shell would split them (--grep "two words").
  const quote = (arg: string) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg);
  const result = spawnSync(command.map(quote).join(' '), {
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      COLLECTOR_URL: `http://${collector.getHost()}:${collector.getMappedPort(4318)}`,
      COLLECTOR_HEALTH_URL: `http://${collector.getHost()}:${collector.getMappedPort(13133)}`,
      JAEGER_URL: `http://${jaeger.getHost()}:${jaeger.getMappedPort(16686)}`,
      COLLECTOR_LOGS_FILE: path.join(out, 'logs.jsonl'),
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  await stopAll();
}
