// Burn-in for pull requests: every Playwright or Cypress spec the PR adds or changes
// runs 3 times with no retries before it can merge. A flaky test usually passes once;
// three clean runs in a row catch a 1-in-3 flake 70% of the time (1 - (2/3)^3), and the
// regular jobs and the Flaky tests workflow keep watching after merge.
//
//   node scripts/burn-in.mjs                  # print the plan for HEAD^1..HEAD
//   node scripts/burn-in.mjs --run            # and run it (CI, pull requests only)
//   node scripts/burn-in.mjs --files a b c    # plan for these paths instead of git
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPEATS = 3;
export const CYPRESS_BROWSERS = ['chrome', 'firefox'];

// Which config runs which folder. scripts/burn-in.test.mjs fails if a Playwright config
// in the repo is missing here, so a new suite can't skip burn-in.
export const PLAYWRIGHT = [
  { pkg: 'a11y-aoda-audit', config: 'playwright.config.js', dirs: ['tests/'] },
  { pkg: 'ai-test-generator', config: 'playwright.config.js', dirs: ['examples/output/', 'tests/generated/'] },
  { pkg: 'ai-test-generator', config: 'playwright.regression.config.js', dirs: ['tests/regression/'] },
  { pkg: 'ai-test-generator', config: 'playwright.review.config.js', dirs: ['tests/review/'] },
  { pkg: 'graphql-test-suite', config: 'playwright.config.js', dirs: ['tests/'] },
  { pkg: 'llm-judge-check', config: 'playwright.config.ts', dirs: ['evidence/'] },
  { pkg: 'money-course', config: 'playwright.config.ts', dirs: ['tests/'], browsers: ['chromium', 'firefox'] },
  { pkg: 'multi-user-flow-patterns', config: 'playwright.config.ts', dirs: ['tests/'] },
  { pkg: 'visual-regression-demo', config: 'playwright.config.ts', dirs: ['tests/'], browsers: ['chromium', 'firefox'] },
  { pkg: 'qa-for-ai-features', config: 'playwright.config.ts', dirs: ['tests/'] },
  { pkg: 'qa-practice-api', config: 'playwright.config.ts', dirs: ['tests/'] },
];
export const CYPRESS = [{ pkg: 'banking-api', dirs: ['cypress/e2e/'] }];

const PLAYWRIGHT_SPEC = /\.(spec|test)\.[cm]?[jt]s$/;
const CYPRESS_SPEC = /\.cy\.[jt]s$/;

// Changed paths (repo-relative, forward slashes) -> what to run.
export function plan(files) {
  const groups = [];
  const add = (key, make, file) => {
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, ...make(), files: [] }));
    if (!g.files.includes(file)) g.files.push(file);
  };
  for (const raw of files) {
    const file = raw.replace(/\\/g, '/');
    const m = file.match(/^packages\/([^/]+)\/(.+)$/);
    if (!m) continue;
    const [, pkg, rel] = m;
    for (const s of PLAYWRIGHT) {
      if (s.pkg === pkg && PLAYWRIGHT_SPEC.test(rel) && s.dirs.some((d) => rel.startsWith(d))) {
        add(`${pkg}/${s.config}`, () => ({ runner: 'playwright', pkg, config: s.config, browsers: s.browsers }), rel);
      }
    }
    for (const s of CYPRESS) {
      if (s.pkg === pkg && CYPRESS_SPEC.test(rel) && s.dirs.some((d) => rel.startsWith(d))) {
        add(`${pkg}/cypress`, () => ({ runner: 'cypress', pkg }), rel);
      }
    }
  }
  return groups;
}

// The commands for one group, as [label, command, args, env] in run order.
export function commands(group) {
  if (group.runner === 'playwright') {
    return [[
      `${group.pkg} (${group.config}) x${REPEATS}`,
      'npx',
      ['playwright', 'test', '-c', group.config, `--repeat-each=${REPEATS}`, '--retries=0', '--reporter=list', ...group.files],
      {},
    ]];
  }
  const out = [];
  for (const browser of CYPRESS_BROWSERS) {
    for (let run = 1; run <= REPEATS; run++) {
      out.push([
        `${group.pkg} cypress ${browser} run ${run}/${REPEATS}`,
        'node',
        ['src/ui-test.ts', '--browser', browser, '--spec', group.files.join(','), '--expose', `BURN_IN_RUN=${run}`],
        {},
      ]);
    }
  }
  return out;
}

function changedFiles() {
  // CI checks out the PR merge commit with depth 2: HEAD^1 is the base branch.
  const res = spawnSync('git', ['diff', '--name-only', '--diff-filter=d', 'HEAD^1', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git diff failed: ${res.stderr}`);
  return res.stdout.split('\n').filter(Boolean);
}

function sh(cmd, args, cwd, env = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}   (in ${path.relative(ROOT, cwd)})`);
  return spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } }).status;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf('--files');
  const files = i >= 0 ? process.argv.slice(i + 1) : changedFiles();
  const groups = plan(files);
  const summary = [`## Burn-in: changed specs x${REPEATS}, no retries`, ''];
  if (!groups.length) summary.push('No Playwright or Cypress spec changed in this pull request; nothing to burn in.');
  for (const g of groups) console.log(`${g.key}: ${g.files.join(', ')}`);

  let failed = 0;
  if (process.argv.includes('--run')) {
    if (groups.length) summary.push('| Run | Specs | Result |', '|---|---|---|');
    const ready = new Set();
    for (const g of groups) {
      const cwd = path.join(ROOT, 'packages', g.pkg);
      if (!ready.has(g.pkg)) {
        if (sh('npm', ['ci', '--no-audit', '--no-fund'], cwd) !== 0) throw new Error(`npm ci failed in ${g.pkg}`);
        if (g.runner === 'playwright' && sh('npx', ['playwright', 'install', '--with-deps', ...(g.browsers ?? ['chromium'])], cwd) !== 0) throw new Error('browser install failed');
        ready.add(g.pkg);
      }
      for (const [label, cmd, args, env] of commands(g)) {
        const ok = sh(cmd, args, cwd, env) === 0;
        if (!ok) failed++;
        summary.push(`| ${label} | ${g.files.map((f) => `\`${f}\``).join(', ')} | ${ok ? 'passed' : '**failed**'} |`);
      }
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
  console.log(`\n${summary.join('\n')}`);
  process.exitCode = failed ? 1 : 0;
}
