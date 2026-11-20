// Runs a command with the sampling Collector (collector/sampling.yaml) in Docker
// (Testcontainers), then removes the container:
//
//   npm run test:sampling                     tests/sampling against the Collector
//   node scripts/with-sampling.ts npx playwright test tests/sampling
//
// The Collector writes three files, one per policy, to a temporary folder. The command gets:
//
//   COLLECTOR_URL         where the API sends OTLP (playwright.config.ts uses it)
//   COLLECTOR_HEALTH_URL  the Collector's health check
//   SAMPLING_OUT          the folder holding all.jsonl, head.jsonl and tail.jsonl
//
// SAMPLING_OUT also turns the API's fault-injection flag on (playwright.config.ts), so the
// load run can make requests that fail. Needs Docker running. The image is the one
// with-collector.ts pins (that file can't be imported: it runs on load), so CI pulls it
// once and scripts/sampling-ci.test.mjs fails if the two tags differ.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait } from 'testcontainers';

export const COLLECTOR_IMAGE = 'otel/opentelemetry-collector-contrib:0.141.0';

const command = process.argv.slice(2);
if (!command.length) {
  console.error('usage: node scripts/with-sampling.ts <command> [args...]');
  process.exit(2);
}

const config = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'collector', 'sampling.yaml');
// The Collector runs as a user of its own: it can only write to a folder everyone can.
const out = mkdtempSync(path.join(tmpdir(), 'sampling-out-'));
chmodSync(out, 0o777);

console.log(`Starting ${COLLECTOR_IMAGE}...`);
let collector: Awaited<ReturnType<GenericContainer['start']>> | undefined;
const stopAll = async () => {
  await Promise.allSettled([collector?.stop()]);
  rmSync(out, { recursive: true, force: true });
};
// Ryuk is off in CI, so Ctrl+C or a CI timeout must clean up too, or the container stays.
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void stopAll().finally(() => process.exit(1)));
try {
  collector = await new GenericContainer(COLLECTOR_IMAGE)
    .withExposedPorts(4318, 13133)
    .withCopyFilesToContainer([{ source: config, target: '/etc/otelcol-contrib/config.yaml' }])
    .withBindMounts([{ source: out, target: '/out', mode: 'rw' }])
    .withWaitStrategy(Wait.forHttp('/', 13133))
    .start();

  // One command string: npx needs a shell on Windows. Arguments with spaces or
  // quotes are quoted again, or the shell would split them.
  const quote = (arg: string) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg);
  const result = spawnSync(command.map(quote).join(' '), {
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      COLLECTOR_URL: `http://${collector.getHost()}:${collector.getMappedPort(4318)}`,
      COLLECTOR_HEALTH_URL: `http://${collector.getHost()}:${collector.getMappedPort(13133)}`,
      SAMPLING_OUT: out,
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  await stopAll();
}
