// Decides whether a browser suite runs only its @smoke tests or everything.
//
// Pull requests get the fast @smoke set; main, the nightly run and manual runs
// get the full suite. A pull request still gets the full suite when skipping it
// would mean merging untested changes:
//   - it changes the suite itself (anything under packages/<package>/)
//   - it changes how CI selects or runs tests (the files in CI_FILES)
//   - it has the `full-regression` label
// When the changed files can't be read, the answer is full: running too much
// costs a minute, running too little lets a broken test merge.
//
// Usage (in CI, after a checkout with fetch-depth: 2):
//   node scripts/test-scope.mjs <package>
// Prints the decision and, on GitHub Actions, writes `scope=smoke|full` to
// $GITHUB_OUTPUT and a line to the job summary.
import { execFileSync } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';

export const FULL_LABEL = 'full-regression';
export const CI_FILES = ['.github/workflows/ci.yml', 'scripts/test-scope.mjs'];

/**
 * @param {{ event: string, pkg: string, labels?: string[], changed?: string[] | null }} input
 *   changed: files the pull request changes; null when they couldn't be read
 * @returns {{ scope: 'smoke' | 'full', reason: string }}
 */
export function decideScope({ event, pkg, labels = [], changed = [] }) {
  if (event !== 'pull_request') return { scope: 'full', reason: `${event} run: full suite` };
  if (labels.includes(FULL_LABEL)) return { scope: 'full', reason: `pull request has the ${FULL_LABEL} label` };
  if (changed === null) return { scope: 'full', reason: 'could not read the changed files, so running everything' };
  const own = changed.find((f) => f.startsWith(`packages/${pkg}/`));
  if (own) return { scope: 'full', reason: `pull request changes the suite (${own})` };
  const ci = changed.find((f) => CI_FILES.includes(f));
  if (ci) return { scope: 'full', reason: `pull request changes how CI runs tests (${ci})` };
  return { scope: 'smoke', reason: 'pull request does not touch this suite: @smoke only, full suite runs on main and nightly' };
}

// On a pull_request run, HEAD is GitHub's merge commit, so its first parent is
// the base branch and the diff between them is exactly what the PR changes.
function changedFiles() {
  try {
    return execFileSync('git', ['diff', '--name-only', 'HEAD^1', 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

function main() {
  const pkg = process.argv[2];
  if (!pkg) {
    console.error('Usage: node scripts/test-scope.mjs <package>');
    process.exit(2);
  }
  const event = process.env.GITHUB_EVENT_NAME ?? 'local';
  /** @type {string[]} */
  let labels = [];
  if (process.env.GITHUB_EVENT_PATH) {
    const payload = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    labels = (payload.pull_request?.labels ?? []).map((/** @type {{ name: string }} */ l) => l.name);
  }
  const { scope, reason } = decideScope({ event, pkg, labels, changed: event === 'pull_request' ? changedFiles() : [] });
  console.log(`${pkg}: ${scope} (${reason})`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**Test scope for ${pkg}: ${scope}.** ${reason}.\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
