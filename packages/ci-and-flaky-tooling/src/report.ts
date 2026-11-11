// The one-page quality report for a manager. Every metric is printed with its value, what it
// means, why it is tracked and how it can mislead, so the number is never read alone.
import type { FlakyRate, RedMain, RunTime } from './metrics.ts';
import type { EscapedSummary, Problem } from './escaped.ts';

export interface ReportInput {
  month: string; // YYYY-MM
  repo: string;
  generated: string; // YYYY-MM-DD, passed in so the same input always gives the same report
  flaky: FlakyRate;
  red: RedMain;
  time: RunTime;
  escaped: EscapedSummary;
  problems: Problem[];
}

/** The metrics shown, in order. The report test checks that this list is what the page prints. */
export const METRICS = ['Escaped bugs', 'Flaky rate', 'Time to fix a red main', 'CI run time'] as const;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

const percent = (rate: number | null) => (rate === null ? 'no runs' : `${(rate * 100).toFixed(1)}%`);
const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);
const minutes = (m: number | null) => (m === null ? 'no runs' : `${m.toFixed(1)} min`);
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/[[\]]/g, '\\$&').replace(/\r?\n/g, ' ');

function block(name: string, value: string, means: string, why: string, misleads: string, extra = ''): string {
  return `## ${name}\n\n**${value}**\n\n- **What it counts:** ${means}\n- **Why it is tracked:** ${why}\n- **How it can mislead:** ${misleads}\n${extra}`;
}

export function toMarkdown(input: ReportInput): string {
  const { escaped, flaky, red, time } = input;
  const escapedRows = escaped.escaped.length === 0
    ? '\nNo escaped bugs found this month.\n'
    : `\n| Bug | Found | Layer that should have caught it | Tests added |\n|---|---|---|---:|\n${escaped.escaped
      .map((e) => `| [${cell(e.title)}](${e.source.startsWith('http') ? e.source : `../../../${e.source}`}) | ${e.found} | ${e.layer} | ${e.testsAdded.length} |`)
      .join('\n')}\n`;
  const layers = escaped.byLayer.length === 0 ? '' : `\nBy layer: ${escaped.byLayer.map((row) => `${row.layer} ${row.count}`).join(', ')}.\n`;
  const open = escaped.withoutTest.length === 0 ? '' : `\n**Still without a test:** ${escaped.withoutTest.map((e) => e.title).join('; ')}.\n`;
  const problems = input.problems.length === 0 ? '' : `\n## Issues that need fixing\n\n${input.problems.map((p) => `- ${p.message} ([issue](${p.source}))`).join('\n')}\n\nThese are escaped-bug issues the report could not read, so they are not counted above.\n`;
  const redValue = red.fixHours.length === 0 && red.stillRed === null
    ? 'main was never red'
    : `median ${red.medianHours === null ? 'none ended' : hours(red.medianHours)} over ${red.fixHours.length} red${red.fixHours.length === 1 ? '' : 's'}`;
  const stillRed = red.stillRed === null ? '' : `\n**Still red:** since ${red.stillRed.since.slice(0, 16).replace('T', ' ')} UTC, ${hours(red.stillRed.hours)} so far. It is counted here, not left out.\n`;

  return `# Quality Report: ${monthName(input.month)}

Repository \`${input.repo}\`, generated ${input.generated}. Four numbers, each with what it counts, why it is tracked and how it can mislead. Read them together, not one at a time.

| Metric | ${monthName(input.month)} |
|---|---|
| Escaped bugs | ${escaped.escaped.length} (${escaped.caughtBeforeMain} more caught before main)${input.problems.length === 0 ? '' : `, plus ${input.problems.length} issue${input.problems.length === 1 ? '' : 's'} not read (see below)`} |
| Flaky rate | ${percent(flaky.rate)} (${flaky.flaky} of ${flaky.total} runs) |
| Time to fix a red main | ${redValue} |
| CI run time | median ${minutes(time.medianMinutes)}, slowest tenth ${minutes(time.p90Minutes)} |

${block(
    'Escaped bugs',
    `${escaped.escaped.length} escaped, ${escaped.caughtBeforeMain} caught before main`,
    'Bugs that got past every check that ran on their change and were found later, from the root-cause pages in docs/rca and from issues filled in with the escaped-bug form.',
    'Each one is a place the checks have a gap. The list says which layer should have caught it and what test now does.',
    'A low count can mean few bugs or few people looking. Fixing a bug without logging it makes the number look better. The count of escaped bugs alone says nothing about severity.',
    `${layers}${escapedRows}${open}`,
  )}
${block(
    'Flaky rate',
    `${percent(flaky.rate)} of CI runs on main passed only after a re-run`,
    'Finished CI runs on main (pushes, the nightly run and manual runs) whose first attempt failed and a later attempt passed, divided by finished runs. A run that failed and stayed red is not flaky, and neither is a green run someone ran again.',
    'A suite that passes on a re-run teaches people to re-run instead of read. The rate shows how often that happens.',
    'A re-run after a real outage (a package registry down, for example) counts too. And a flaky test that people have stopped re-running, because they skip it, does not count at all.',
  )}
${block(
    'Time to fix a red main',
    redValue,
    'From the first failed run on main to the start of the next green one. Several failed runs in a row are one red.',
    'A red main blocks everyone and hides new failures. How quickly it goes green again shows whether people treat a failing check as urgent.',
    'A fix that only turns the check off is fast and wrong. Weekend and overnight reds count their full length, so they pull the median up.',
    stillRed,
  )}
${block(
    'CI run time',
    `median ${minutes(time.medianMinutes)}, slowest tenth ${minutes(time.p90Minutes)}`,
    'Minutes from the start to the end of the last attempt of each finished CI run on main.',
    'A pipeline people wait on is a pipeline people skip. The slowest tenth shows what a bad day feels like, not just the average one.',
    'A faster run can mean fewer or weaker checks. Read it next to the escaped bugs.',
  )}${problems}
## Left Out On Purpose

The number of tests and code coverage are not here. More tests do not mean fewer escaped bugs, and a target for either one rewards writing tests that are easy to pass.
`;
}
