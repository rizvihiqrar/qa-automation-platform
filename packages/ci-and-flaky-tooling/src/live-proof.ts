// npm run live-proof [-- --playwright path/to/package]
// Runs the stop-lost-run reporter in real Playwright (no browser needed), in four runs, and fails
// unless each does what the reporter promises. The package has no dependencies of its own, so it
// borrows @playwright/test from another package in the repo (default: llm-judge-check, after npm ci there).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packageRoot, repoRoot } from './build.ts';

const at = process.argv.indexOf('--playwright');
const given = at === -1 ? undefined : process.argv[at + 1];
if (at !== -1 && (!given || given.startsWith('--'))) {
  console.error('Usage: npm run live-proof [-- --playwright <folder of a package that has @playwright/test installed>]');
  process.exit(1);
}
const from = path.resolve(given ?? path.join(repoRoot, 'packages', 'llm-judge-check'));
const cli = path.join(from, 'node_modules', '@playwright', 'test', 'cli.js');
if (!fs.existsSync(cli)) {
  console.error(`No @playwright/test in ${from}. Run npm ci there, or pass --playwright <package folder>.`);
  process.exit(1);
}

// A scratch folder with the fixture, the reporter and a link to that package's node_modules.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lost-run-'));
fs.cpSync(path.join(packageRoot, 'live-run'), work, { recursive: true });
fs.copyFileSync(path.join(packageRoot, 'src', 'stop-lost-run.ts'), path.join(work, 'stop-lost-run.ts'));
fs.symlinkSync(path.join(from, 'node_modules'), path.join(work, 'node_modules'), 'junction');

interface Result { name: string; ran: number; seconds: number; exit: number | null; stopped: boolean }

function run(name: string, mode: string, stop: boolean): Result {
  const started = Date.now();
  const out = spawnSync(process.execPath, [cli, 'test'], { cwd: work, encoding: 'utf8', env: { ...process.env, MODE: mode, STOP: stop ? '1' : '0', FORCE_COLOR: '0' } });
  const text = `${out.stdout}\n${out.stderr}`;
  return { name, ran: new Set(text.match(/check \d+/g)).size, seconds: Math.round((Date.now() - started) / 100) / 10, exit: out.status, stopped: text.includes('Stopping the run:') };
}

let results: Result[];
try {
  results = [
    run('healthy, reporter on', 'healthy', true),
    run('broken, reporter off', 'broken', false),
    run('broken, reporter on', 'broken', true),
    run('5 flaky in 20, reporter on', 'flaky', true),
  ];
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

const [healthy, brokenOff, brokenOn, flaky] = results as [Result, Result, Result, Result];
const expectations: [string, boolean][] = [
  ['a healthy run is never stopped and passes', healthy.ran === 60 && !healthy.stopped && healthy.exit === 0],
  ['a broken run without the reporter runs all 60 checks', brokenOff.ran === 60 && brokenOff.exit !== 0],
  ['a broken run with the reporter stops at check 20 with the message and a failing exit', brokenOn.ran === 20 && brokenOn.stopped && brokenOn.exit === 1],
  ['5 flaky failures in the first 20 do not stop the run (it still fails on its own)', flaky.ran === 60 && !flaky.stopped && flaky.exit !== 0],
];

console.log('| Run | Checks that finished | Seconds | Stopped by reporter |\n|---|---|---|---|');
for (const r of results) console.log(`| ${r.name} | ${r.ran} | ${r.seconds} | ${r.stopped ? 'yes' : 'no'} |`);
const bad = expectations.filter(([, ok]) => !ok);
for (const [what, ok] of expectations) console.log(`${ok ? 'ok     ' : 'FAILED '} ${what}`);
process.exit(bad.length ? 1 : 0);
