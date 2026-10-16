#!/usr/bin/env node
// Usage: node src/bench.ts --dir <playwright-project> [--workers 1,2,4] [--runs 1]
// Runs the suite at each worker count and prints how the wall-clock time scales.
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { parseArgs, parseCounts } from './parse.ts';
import { summarize, toMarkdown, type Run } from './summarize.ts';

const args = parseArgs(process.argv.slice(2));
const runs: Run[] = [];

for (const workers of args.workers) {
  for (let run = 1; run <= args.runs; run++) {
    console.error(`workers=${workers} run ${run}/${args.runs} ...`);
    const start = performance.now();
    // One command string: npx needs a shell on Windows, and Node warns when args are passed with shell: true.
    const result = spawnSync(`npx playwright test --workers=${workers} --reporter=line`, {
      cwd: args.dir,
      shell: true,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    });
    const seconds = (performance.now() - start) / 1000;
    const counts = parseCounts(`${result.stdout}\n${result.stderr}`);
    runs.push({ workers, seconds, ...counts });
  }
}

const rows = summarize(runs);
console.log(`Suite: ${args.dir}\nRuns per worker count: ${args.runs}\n`);
console.log(toMarkdown(rows));
