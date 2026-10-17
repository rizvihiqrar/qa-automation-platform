// Proves a sharded run covered the suite: every test Playwright lists ran exactly
// once across the shards, and nothing ran that isn't listed. Pure functions,
// unit-tested.
//
// Why this is needed: a merged report only shows what it was given. If one
// shard's report never reaches the merge job, the merged run is green with fewer
// tests. If a shard ran twice, merge-reports gives the copies new IDs, so they
// look like different tests that also passed. Neither changes the exit code.
//
// Tests are matched by file, describe titles, test title and project, not by ID,
// because merge-reports rewrites IDs when two reports contain the same test.

// The parts of a Playwright JSON report this module reads.
export interface ShardResult { retry?: number }
export interface ShardTest { projectName?: string; status?: string; results?: ShardResult[] }
export interface ShardSpec { title?: string; file?: string; tests?: ShardTest[] }
export interface ShardSuite { title?: string; file?: string; specs?: ShardSpec[]; suites?: ShardSuite[] }
export interface ShardReport { suites?: ShardSuite[] }

export interface TestRun {
  // First attempts only: a retry is the same run, not a duplicate.
  runs: number;
  // Playwright's verdicts for each copy: expected, unexpected, flaky or skipped.
  statuses: string[];
}

export interface ShardCheck {
  ok: boolean;
  listed: number;
  ran: number;
  missing: string[];
  duplicated: string[];
  unexpected: string[];
  failed: string[];
  flaky: string[];
}

// "file › describe › title [project]". The top-level suite is the file itself.
function walk(report: ShardReport, visit: (key: string, test: ShardTest) => void): void {
  const go = (suite: ShardSuite, file: string, titles: string[]) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const project = test.projectName ? ` [${test.projectName}]` : '';
        visit([file, ...titles, spec.title ?? ''].join(' › ') + project, test);
      }
    }
    for (const child of suite.suites ?? []) go(child, file, [...titles, child.title ?? '']);
  };
  for (const top of report.suites ?? []) go(top, (top.file ?? top.title ?? '').replace(/\\/g, '/'), []);
}

// Every test in a `playwright test --list --reporter=json` report.
export function listedTests(report: ShardReport): string[] {
  const keys: string[] = [];
  walk(report, (key) => keys.push(key));
  return keys;
}

// What actually ran, from a merged report.
export function ranTests(report: ShardReport): Map<string, TestRun> {
  const runs = new Map<string, TestRun>();
  walk(report, (key, test) => {
    const entry = runs.get(key) ?? { runs: 0, statuses: [] };
    entry.runs += (test.results ?? []).filter((r) => (r.retry ?? 0) === 0).length;
    if (test.status) entry.statuses.push(test.status);
    runs.set(key, entry);
  });
  return runs;
}

export function checkShards(listed: string[], ran: Map<string, TestRun>): ShardCheck {
  const expected = new Set(listed);
  const missing = listed.filter((key) => (ran.get(key)?.runs ?? 0) === 0);
  const duplicated = listed.filter((key) => (ran.get(key)?.runs ?? 0) > 1);
  const unexpected = [...ran.keys()].filter((key) => !expected.has(key));
  const withStatus = (status: string) => [...ran].filter(([, r]) => r.statuses.includes(status)).map(([key]) => key);
  return {
    ok: missing.length === 0 && duplicated.length === 0 && unexpected.length === 0,
    listed: listed.length,
    ran: [...ran.values()].reduce((sum, r) => sum + r.runs, 0),
    missing,
    duplicated,
    unexpected,
    failed: withStatus('unexpected'),
    flaky: withStatus('flaky'),
  };
}

export function toMarkdown(check: ShardCheck, shards?: number): string {
  const lines = [
    `## Shard check: ${check.ok ? 'complete' : 'INCOMPLETE'}`,
    '',
    `| Listed | Ran${shards ? ` (${shards} shard reports)` : ''} | Missing | Ran more than once | Not listed | Failed | Flaky |`,
    '|---:|---:|---:|---:|---:|---:|---:|',
    `| ${check.listed} | ${check.ran} | ${check.missing.length} | ${check.duplicated.length} | ${check.unexpected.length} | ${check.failed.length} | ${check.flaky.length} |`,
  ];
  const section = (title: string, keys: string[]) => {
    if (keys.length === 0) return;
    lines.push('', `**${title}**`, '', ...keys.map((key) => `- ${key}`));
  };
  section('Missing: listed but never ran', check.missing);
  section('Ran more than once', check.duplicated);
  section('Ran but not listed', check.unexpected);
  section('Failed', check.failed);
  section('Flaky: passed on retry', check.flaky);
  return lines.join('\n') + '\n';
}
