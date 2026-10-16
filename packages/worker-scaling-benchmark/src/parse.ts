// Reads pass and fail counts from Playwright's line reporter output.

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

export interface Counts {
  passed: number;
  failed: number;
  flaky: number;
}

export function parseCounts(output: string): Counts {
  const text = output.replace(ANSI, '');
  const last = (pattern: RegExp): number => {
    const matches = [...text.matchAll(pattern)];
    const final = matches[matches.length - 1];
    return final ? Number(final[1]) : 0;
  };
  // Flaky tests pass only after a retry, so they're counted separately from clean passes.
  return {
    passed: last(/(\d+) passed/g),
    failed: last(/(\d+) failed/g),
    flaky: last(/(\d+) flaky/g),
  };
}

export interface Args {
  dir: string;
  workers: number[];
  runs: number;
}

export function parseArgs(argv: readonly string[]): Args {
  let dir: string | null = null;
  let workers = [1, 2, 4];
  let runs = 1;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1] ?? '';
    if (flag === '--dir') { dir = value; i++; }
    else if (flag === '--workers') { workers = value.split(',').map(Number); i++; }
    else if (flag === '--runs') { runs = Number(value); i++; }
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!dir) throw new Error('Missing --dir <folder with a Playwright project>');
  if (workers.some((n) => !Number.isInteger(n) || n < 1)) throw new Error('--workers must be positive integers');
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  return { dir, workers, runs };
}
