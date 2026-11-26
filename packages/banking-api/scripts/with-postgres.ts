// Runs a command with a fresh Postgres in Docker (Testcontainers) and DATABASE_URL pointing at
// it, then removes the container:
//
//   npm run test:postgres                                   the Node tests on Postgres
//   node scripts/with-postgres.ts node --test test/postgres.test.ts
//
// Each test server makes its own schema in that database (test/helpers.ts), so tests never see
// each other's rows. Needs Docker running. The image is pinned so a new release can't change the
// results without a commit; CI pulls the same tag first (scripts/postgres-ci.test.mjs at the root).
import { spawnSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

export const POSTGRES_IMAGE = 'postgres:17-alpine';

const command = process.argv.slice(2);
if (!command.length) {
  console.error('usage: node scripts/with-postgres.ts <command> [args...]');
  process.exit(2);
}

console.log(`Starting ${POSTGRES_IMAGE}...`);
// More connections than the default 100: every test server opens a pool of its own.
const postgres = await new PostgreSqlContainer(POSTGRES_IMAGE).withCommand(['postgres', '-c', 'max_connections=400']).start();
try {
  // One command string: npx needs a shell on Windows. Anything but plain characters is quoted
  // again, or the shell would split it, expand it, or read | & ; < > as its own.
  const quote = (arg: string) => (/^[\w./=:@%+,-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`);
  const result = spawnSync(command.map(quote).join(' '), {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: postgres.getConnectionUri() },
  });
  process.exitCode = result.status ?? 1;
} finally {
  await postgres.stop();
}
