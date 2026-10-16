// Reads pass and fail counts from Playwright's line reporter output.

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

export function parseCounts(output) {
  const text = output.replace(ANSI, '');
  const last = (pattern) => {
    const matches = [...text.matchAll(pattern)];
    return matches.length ? Number(matches[matches.length - 1][1]) : 0;
  };
  // Flaky tests pass only after a retry, so they're counted separately from clean passes.
  return {
    passed: last(/(\d+) passed/g),
    failed: last(/(\d+) failed/g),
    flaky: last(/(\d+) flaky/g),
  };
}

export function parseArgs(argv) {
  const args = { dir: null, workers: [1, 2, 4], runs: 1 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--dir') { args.dir = value; i++; }
    else if (flag === '--workers') { args.workers = value.split(',').map(Number); i++; }
    else if (flag === '--runs') { args.runs = Number(value); i++; }
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!args.dir) throw new Error('Missing --dir <folder with a Playwright project>');
  if (args.workers.some((n) => !Number.isInteger(n) || n < 1)) throw new Error('--workers must be positive integers');
  if (!Number.isInteger(args.runs) || args.runs < 1) throw new Error('--runs must be a positive integer');
  return args;
}
