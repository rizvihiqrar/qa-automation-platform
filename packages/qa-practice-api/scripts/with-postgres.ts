// Runs a command with a fresh Postgres in Docker (Testcontainers) and DATABASE_URL
// pointing at it, then removes the container:
//
//   npm run test:postgres                      the whole Playwright suite on Postgres
//   node scripts/with-postgres.ts npx playwright test tests/concurrency.spec.ts
//
// Needs Docker running. The image is pinned to a major version so a new Postgres
// release can't change the results without a commit.
import { spawnSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

export const POSTGRES_IMAGE = 'postgres:17-alpine';

const command = process.argv.slice(2);
if (!command.length) {
  console.error('usage: node scripts/with-postgres.ts <command> [args...]');
  process.exit(2);
}

console.log(`Starting ${POSTGRES_IMAGE}...`);
const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
try {
  // One command string: npx needs a shell on Windows. Arguments with spaces or
  // quotes are quoted again, or the shell would split them (--grep "two words").
  const quote = (arg: string) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg);
  const result = spawnSync(command.map(quote).join(' '), {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
  });
  process.exitCode = result.status ?? 1;
} finally {
  await container.stop();
}
