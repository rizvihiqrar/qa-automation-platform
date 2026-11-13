// A Playwright reporter that stops a run that is already lost: once enough tests have finished
// and too many of them failed, it prints why and exits, so a broken deploy fails in a minute
// and not after the whole suite has run. Playwright's own `maxFailures` is a plain count, which
// a big suite hits late and a small one hits too early; this is a rate after a minimum.
//
//   reporter: [['list'], ['path/to/stop-lost-run.ts', { rate: 0.3, after: 20 }]]
//
// A test counts once, at its final result: a failure that a retry will redo is not counted yet,
// a test that failed and then passed counts as a pass, and a skipped test is not counted at all.

export interface LostRunOptions {
  /** Stop when this share of the finished tests failed (0.3 is 30%). */
  rate: number;
  /** Do not judge before this many tests have finished: the first few failures say little. */
  after: number;
}

export const DEFAULTS: LostRunOptions = { rate: 0.3, after: 20 };

/** The reporter options from the config, with defaults filled in. A bad value is an error, never a silent default. */
export function parseOptions(raw: unknown = {}): LostRunOptions {
  const given = (raw ?? {}) as Partial<LostRunOptions>;
  const rate = given.rate ?? DEFAULTS.rate;
  const after = given.after ?? DEFAULTS.after;
  if (typeof rate !== 'number' || !(rate > 0 && rate <= 1)) throw new Error(`stop-lost-run: rate must be above 0 and at most 1 (0.3 is 30%), not ${JSON.stringify(rate)}`);
  if (!Number.isInteger(after) || after < 1) throw new Error(`stop-lost-run: after must be a whole number of tests, 1 or more, not ${JSON.stringify(after)}`);
  return { rate, after };
}

export class LostRunGuard {
  passed = 0;
  failed = 0;
  private tripped = false;
  readonly options: LostRunOptions;

  constructor(options: LostRunOptions = DEFAULTS) {
    this.options = options;
  }

  /** Records one finished test. Returns the stop message the first time the run counts as lost, otherwise null. */
  record(failed: boolean): string | null {
    if (failed) this.failed += 1;
    else this.passed += 1;
    const finished = this.passed + this.failed;
    if (this.tripped || finished < this.options.after || this.failed / finished < this.options.rate) return null;
    this.tripped = true;
    const percent = Math.round((this.failed / finished) * 100);
    return `Stopping the run: ${this.failed} of ${finished} finished tests failed (${percent}%; the limit is ${Math.round(this.options.rate * 100)}% once ${this.options.after} have finished). The environment looks broken: fix that before running the rest.`;
  }
}

// The parts of Playwright's TestCase and TestResult used here, so the package needs no dependency.
export interface TestLike { retries: number; expectedStatus: string }
export interface ResultLike { status: string; retry: number }

/**
 * How a test ended for good: 'passed', 'failed', or null when it is skipped, was cut off (Ctrl-C or a global timeout:
 * that says nothing about the environment) or a retry is still to come.
 */
export function finalOutcome(test: TestLike, result: ResultLike): 'passed' | 'failed' | null {
  if (result.status === 'skipped' || result.status === 'interrupted') return null;
  if (result.status === test.expectedStatus) return 'passed';
  return result.retry >= test.retries ? 'failed' : null;
}

export default class StopLostRun {
  private readonly guard: LostRunGuard;

  private readonly abort: (message: string) => void;

  constructor(options?: unknown, abort: (message: string) => void = (message) => {
    process.stderr.write(`\n${message}\n`, () => process.exit(1));
  }) {
    this.guard = new LostRunGuard(parseOptions(options));
    this.abort = abort;
  }

  printsToStdio(): boolean {
    return false;
  }

  onTestEnd(test: TestLike, result: ResultLike): void {
    const outcome = finalOutcome(test, result);
    if (outcome === null) return;
    const message = this.guard.record(outcome === 'failed');
    if (message) this.abort(message);
  }
}
