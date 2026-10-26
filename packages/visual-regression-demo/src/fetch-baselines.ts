// Brings the Linux baselines a CI run made into baselines/linux/, ready to commit.
//   npm run baselines -- <run id>          # from a failed CI run (it keeps what it wrote)
//   npm run baselines -- <run id> update   # from a run of the "Visual baselines" workflow
// Needs the GitHub CLI, signed in. Look at every changed picture before committing it: a baseline
// is the answer key, and a wrong one makes the suite agree with a bug.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [runId, mode] = process.argv.slice(2);
if (!runId || !/^\d+$/.test(runId) || (mode !== undefined && mode !== 'update')) {
  console.error('usage: npm run baselines -- <run id> [update]');
  process.exit(2);
}
const artifact = mode === 'update' ? 'visual-baselines-updated' : 'visual-baselines';
const target = fileURLToPath(new URL('../baselines/linux', import.meta.url));
const run = spawnSync('gh', ['run', 'download', runId, '--name', artifact, '--dir', target], { stdio: 'inherit' });
if (run.status === 0) console.log(`\nBaselines from run ${runId} are in baselines/linux. Review the changed pictures, then commit them.`);
process.exitCode = run.status ?? 1;
