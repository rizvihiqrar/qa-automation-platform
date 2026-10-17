// Turns the analysis of recent CI runs into a flaky-test list and a plan for the
// GitHub issues that track them: one open issue per flaky test, labelled
// `flaky-test`. Pure functions, unit-tested; src/github.ts applies the plan.
//
// Lifecycle:
//   - A test that needed a retry, or failed while passing in other runs, gets an issue.
//   - While it stays flaky, the issue body is refreshed with the latest counts.
//   - It closes once the test passed first time in every analyzed run, and ran in
//     at least MIN_CLEAN_RUNS of them, so one lucky run doesn't close it.
//   - A test that now fails in every run keeps its issue open, marked as broken.
//   - A test missing from every analyzed run was renamed or removed; its issue closes.
import type { AnalyzedRow } from './analyze.ts';
import { wilson, zeroFailureUpperBound } from './stats.ts';

export const LABEL = 'flaky-test';
export const MIN_CLEAN_RUNS = 5;
const TITLE_PREFIX = 'Flaky test: ';
const MARKER = '<!-- managed by flaky-test-analyzer; edits to this body are overwritten -->';

export const issueTitle = (id: string): string => TITLE_PREFIX + id;

export interface FlakyEntry {
  id: string;
  runs: number;
  passed: number;
  flaky: number;
  failed: number;
  flakeRate: number;
  unstableRuns: string[];
}

export interface FlakyList {
  generatedAt: string;
  /** The analyzed runs, oldest first. */
  runs: string[];
  flaky: FlakyEntry[];
  /** Tests that failed in every run: broken, not flaky. */
  failing: string[];
}

export function buildFlakyList(rows: readonly AnalyzedRow[], runs: readonly string[], generatedAt: string): FlakyList {
  return {
    generatedAt,
    runs: [...runs],
    flaky: rows
      .filter((r) => r.label === 'flaky')
      .map(({ id, runs: n, passed, flaky, failed, flakeRate, unstableRuns }) => ({ id, runs: n, passed, flaky, failed, flakeRate, unstableRuns })),
    failing: rows.filter((r) => r.label === 'failing').map((r) => r.id),
  };
}

export interface Issue {
  number: number;
  title: string;
  body: string;
}

export type IssueAction =
  | { kind: 'open'; title: string; body: string }
  | { kind: 'update'; number: number; title: string; body: string }
  | { kind: 'close'; number: number; title: string; comment: string };

/** Turns a run name into a Markdown link; plain text when there is no repo to link to. */
export type RunLink = (run: string) => string;
const plainRun: RunLink = (run) => `run ${run}`;

const pct = (rate: number): string => `${Math.round(rate * 100)}%`;

export function flakyBody(entry: FlakyEntry, windowRuns: number, link: RunLink = plainRun): string {
  const unstable = entry.flaky + entry.failed;
  const ci = wilson(unstable, entry.runs);
  return [
    MARKER,
    `**Test:** \`${entry.id}\``,
    '',
    `Unstable in **${unstable} of ${entry.runs}** runs (flake rate ${pct(entry.flakeRate)}, 95% CI ${pct(ci.low)}–${pct(ci.high)}), over the last ${windowRuns} CI runs on main.`,
    '',
    '| Result | Runs |',
    '|---|---:|',
    `| Passed first time | ${entry.passed} |`,
    `| Passed on retry | ${entry.flaky} |`,
    `| Failed | ${entry.failed} |`,
    '',
    `Unstable in: ${entry.unstableRuns.map(link).join(', ')}`,
    '',
    `This issue closes on its own once the test passes first time in every analyzed run, and has run at least ${MIN_CLEAN_RUNS} times. ` +
      `A close is not proof the flake is gone: ${windowRuns} clean runs only show the flake rate is below ${pct(zeroFailureUpperBound(windowRuns))} (95% confidence).`,
  ].join('\n');
}

function failingBody(id: string, windowRuns: number): string {
  return [
    MARKER,
    `**Test:** \`${id}\``,
    '',
    `Was flaky; now **fails in every one of the last ${windowRuns} CI runs** on main. That is a broken test or a real bug, not flakiness. Fix or remove it.`,
  ].join('\n');
}

export function planIssues(
  list: FlakyList,
  rows: readonly AnalyzedRow[],
  open: readonly Issue[],
  link: RunLink = plainRun,
): IssueAction[] {
  const window = list.runs.length;
  const actions: IssueAction[] = [];
  // Only issues this tool manages; anything else with the label is left alone.
  const managed = new Map(open.filter((i) => i.title.startsWith(TITLE_PREFIX)).map((i) => [i.title.slice(TITLE_PREFIX.length), i]));

  for (const entry of list.flaky) {
    const title = issueTitle(entry.id);
    const body = flakyBody(entry, window, link);
    const issue = managed.get(entry.id);
    if (!issue) actions.push({ kind: 'open', title, body });
    else if (issue.body !== body) actions.push({ kind: 'update', number: issue.number, title, body });
  }

  const flaky = new Set(list.flaky.map((e) => e.id));
  const failing = new Set(list.failing);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const [id, issue] of managed) {
    if (flaky.has(id)) continue;
    if (failing.has(id)) {
      const body = failingBody(id, window);
      if (issue.body !== body) actions.push({ kind: 'update', number: issue.number, title: issue.title, body });
      continue;
    }
    const row = byId.get(id);
    if (!row) {
      // Too few runs to say a test is gone: the history may just be short.
      if (window >= MIN_CLEAN_RUNS) {
        actions.push({ kind: 'close', number: issue.number, title: issue.title, comment: `Not found in any of the last ${window} CI runs, so the test was renamed or removed. Closing.` });
      }
    } else if (row.runs >= MIN_CLEAN_RUNS) {
      actions.push({
        kind: 'close',
        number: issue.number,
        title: issue.title,
        comment:
          `Passed first time in all ${row.runs} of the last ${window} CI runs, so its flake rate is now below ${pct(zeroFailureUpperBound(row.runs))} (95% confidence). ` +
          `That rules out frequent flakes, not rare ones. Closing; it reopens as a new issue if it flakes again.`,
      });
    }
  }
  return actions;
}

export function summaryMarkdown(list: FlakyList, actions: readonly IssueAction[], applied: boolean): string {
  const lines = [`## Flaky tests: ${list.flaky.length} over the last ${list.runs.length} CI runs`, ''];
  if (list.flaky.length === 0) lines.push('No test needed a retry or failed intermittently.');
  else {
    lines.push('| Test | Runs | Passed on retry | Failed | Flake rate |', '|---|---:|---:|---:|---:|');
    for (const e of list.flaky) lines.push(`| ${e.id} | ${e.runs} | ${e.flaky} | ${e.failed} | ${pct(e.flakeRate)} |`);
  }
  if (list.failing.length) lines.push('', `**Failing in every run (broken, not flaky):** ${list.failing.join('; ')}`);
  lines.push('', `### Issues${applied ? '' : ' (dry run: nothing changed)'}`, '');
  if (actions.length === 0) lines.push('No changes.');
  for (const a of actions) lines.push(`- ${a.kind === 'open' ? 'Open' : a.kind === 'update' ? `Update #${a.number}` : `Close #${a.number}`}: ${a.title}`);
  return lines.join('\n') + '\n';
}
