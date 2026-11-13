// A sprint burndown from two plain inputs: a ticket export (when each ticket was opened and closed)
// and the last test run of each day (how many cases were still failing). For each working day it
// reports the tickets left at the end of the day, the straight line a sprint would follow if work
// finished evenly, and the failing cases, and it says when the work grew instead of shrinking.
// Everything is derived from dates, so a hand count of any day can be compared with it.
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from './build.ts';

export interface Ticket {
  id: string;
  opened: string; // YYYY-MM-DD
  closed: string | null; // YYYY-MM-DD, null while open
}

export interface TestRun {
  date: string; // YYYY-MM-DD: the last run of that day
  failing: number;
  total: number;
}

export interface Sprint {
  label: string;
  start: string; // YYYY-MM-DD, a weekday
  days: number; // working days
  tickets: Ticket[];
  testRuns: TestRun[];
}

export interface Day {
  day: number;
  date: string;
  /** Tickets opened on or before this day and not closed on or before it. */
  ticketsLeft: number;
  /** Where an even burn from day 1's count to zero on the last day would be, to one decimal. */
  ideal: number;
  /** Failing cases in the latest run on or before this day; null before the first run. */
  casesFailing: number | null;
  /** The date of that run, so a day with no run of its own shows where its number came from. */
  runDate: string | null;
  notes: string[];
}

export function readSprint(): Sprint {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, 'data', 'sprint.json'), 'utf8')) as Sprint;
}

const isWeekend = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());

/** The working days (Monday to Friday) of a sprint, from its first day. */
export function sprintDates(start: string, days: number): string[] {
  const dates: string[] = [];
  const at = new Date(`${start}T00:00:00Z`);
  while (dates.length < days) {
    const iso = at.toISOString().slice(0, 10);
    if (!isWeekend(iso)) dates.push(iso);
    at.setUTCDate(at.getUTCDate() + 1);
  }
  return dates;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A written date that is a real day on the calendar: 2026-02-30 is not. */
const isRealDate = (iso: unknown): iso is string => {
  if (typeof iso !== 'string' || !DATE.test(iso)) return false;
  const at = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === iso;
};

/** One message per problem in the sprint data. A burndown from bad data would be wrong without looking wrong. */
export function checkSprint(sprint: Sprint): string[] {
  const problems: string[] = [];
  if (!Array.isArray(sprint.tickets) || !Array.isArray(sprint.testRuns)) return ['tickets and testRuns must both be lists'];
  if (!isRealDate(sprint.start) || isWeekend(sprint.start)) problems.push(`start ${sprint.start} must be a weekday written YYYY-MM-DD`);
  if (!Number.isInteger(sprint.days) || sprint.days < 1) problems.push(`days must be a whole number of 1 or more, not ${sprint.days}`);
  const ids = new Set<string>();
  for (const t of sprint.tickets) {
    if (ids.has(t.id)) problems.push(`${t.id}: listed twice`);
    ids.add(t.id);
    if (!isRealDate(t.opened) || (t.closed !== null && !isRealDate(t.closed))) problems.push(`${t.id}: dates must be real days written YYYY-MM-DD`);
    else if (t.closed !== null && t.closed < t.opened) problems.push(`${t.id}: closed ${t.closed} is before it was opened ${t.opened}`);
  }
  const runDates = new Set<string>();
  for (const r of sprint.testRuns) {
    if (runDates.has(r.date)) problems.push(`${r.date}: two test runs listed for one day (keep the last)`);
    runDates.add(r.date);
    if (!isRealDate(r.date)) problems.push(`${r.date}: run date must be a real day written YYYY-MM-DD`);
    if (!(r.failing >= 0 && r.total >= r.failing)) problems.push(`${r.date}: ${r.failing} failing of ${r.total} cases does not add up`);
  }
  return problems;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function burndown(sprint: Sprint): Day[] {
  const dates = sprintDates(sprint.start, sprint.days);
  const runs = [...sprint.testRuns].sort((a, b) => a.date.localeCompare(b.date));
  const left = (date: string) => sprint.tickets.filter((t) => t.opened <= date && (t.closed === null || t.closed > date)).length;
  const start = left(dates[0]!);
  const last = dates.length - 1;
  const days: Day[] = dates.map((date, i) => {
    const run = [...runs].reverse().find((r) => r.date <= date) ?? null;
    return {
      day: i + 1,
      date,
      ticketsLeft: left(date),
      ideal: last === 0 ? 0 : round1((start * (last - i)) / last),
      casesFailing: run ? run.failing : null,
      runDate: run ? run.date : null,
      notes: [],
    };
  });
  days.forEach((d, i) => {
    if (d.runDate !== null && d.runDate !== d.date) d.notes.push(`no run: shows ${d.runDate}`);
    const before = days[i - 1];
    if (!before) return;
    if (d.ticketsLeft > before.ticketsLeft) d.notes.push(`tickets grew (+${d.ticketsLeft - before.ticketsLeft})`);
    if (d.casesFailing !== null && before.casesFailing !== null && d.casesFailing > before.casesFailing) d.notes.push(`failing cases grew (+${d.casesFailing - before.casesFailing})`);
  });
  return days;
}

const bar = (n: number) => '█'.repeat(n);

export function burndownMarkdown(sprint: Sprint): string {
  const days = burndown(sprint);
  const row = (d: Day) => `| ${d.day} | ${d.date} | ${d.ticketsLeft} ${bar(d.ticketsLeft)} | ${d.ideal} | ${d.casesFailing ?? '–'} | ${d.notes.join('; ')} |`;
  const end = days[days.length - 1]!;
  const first = days[0]!;
  // Tickets that were in the sprint at some point: not closed before it began, not opened after it ended.
  const inSprint = sprint.tickets.filter((t) => t.opened <= end.date && (t.closed === null || t.closed >= first.date)).length;
  return [
    '# Sprint Burndown',
    '',
    `${sprint.label}`,
    '',
    'Made from `data/sprint.json` by `npm run planning`. Tickets left is counted at the end of each working day: opened on or before that day and not closed on or before it. The even line goes from day 1\'s count to zero on the last day. Failing cases come from the last test run on or before the day, and a day with no run shows the earlier number and says so. A test compares every day with a hand count.',
    '',
    '| Day | Date | Tickets left | Even line | Failing cases | Note |',
    '|---|---|---|---|---|---|',
    ...days.map(row),
    '',
    `At the end of day ${end.day}: ${end.ticketsLeft} of ${inSprint} tickets still open (they carry over) and ${end.casesFailing ?? 'no'} failing ${end.casesFailing === 1 ? 'case' : 'cases'}.`,
    '',
  ].join('\n');
}
