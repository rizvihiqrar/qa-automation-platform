import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from '../src/build.ts';
import { burndown, burndownMarkdown, checkSprint, readSprint, sprintDates, type Sprint } from '../src/burndown.ts';

// The hand count for the seeded sprint (data/sprint.json), written out by counting the tickets on paper:
// 10 tickets on day 1; T-1 closes on the 3rd; T-11 and T-12 are added on the 4th (12 opened, 2 closed: 10);
// T-2 closes on the 5th, T-4 on the 6th; T-13 is added on the 9th while T-5 and T-11 close (13 opened, 6 closed: 7);
// T-6 and T-7 close on the 10th, T-13 on the 11th, T-8 on the 12th, T-9 on the 13th; T-10 and T-12 never close.
const HAND_TICKETS = [10, 9, 10, 9, 8, 7, 5, 4, 3, 2];
const HAND_IDEAL = [10, 8.9, 7.8, 6.7, 5.6, 4.4, 3.3, 2.2, 1.1, 0];
// Failing cases: the last run on or before each day (no run on the 5th: the 4th's 14 carries over).
const HAND_FAILING = [12, 11, 14, 14, 9, 7, 5, 5, 2, 1];

test('the seeded sprint has no problems', () => {
  assert.deepEqual(checkSprint(readSprint()), []);
});

test('every day of the seeded sprint matches the hand count', () => {
  const days = burndown(readSprint());
  assert.deepEqual(days.map((d) => d.ticketsLeft), HAND_TICKETS);
  assert.deepEqual(days.map((d) => d.ideal), HAND_IDEAL);
  assert.deepEqual(days.map((d) => d.casesFailing), HAND_FAILING);
});

test('the working days skip the weekend', () => {
  assert.deepEqual(sprintDates('2026-03-02', 10), ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13']);
  assert.deepEqual(sprintDates('2026-03-06', 2), ['2026-03-06', '2026-03-09']);
});

test('a day when work grew says so, and a day with no run says where its number came from', () => {
  const days = burndown(readSprint());
  assert.deepEqual(days[2]!.notes, ['tickets grew (+1)', 'failing cases grew (+3)']);
  assert.deepEqual(days[3]!.notes, ['no run: shows 2026-03-04']);
  assert.deepEqual(days[1]!.notes, []);
});

test('a ticket closed on a day is not left at the end of that day, and one opened that day is', () => {
  const sprint: Sprint = { label: 'x', start: '2026-03-02', days: 2, testRuns: [], tickets: [
    { id: 'a', opened: '2026-03-02', closed: '2026-03-02' },
    { id: 'b', opened: '2026-03-02', closed: null },
    { id: 'c', opened: '2026-03-03', closed: null },
  ] };
  assert.deepEqual(burndown(sprint).map((d) => d.ticketsLeft), [1, 2]);
});

test('before the first run there is no number, never a zero', () => {
  const sprint: Sprint = { label: 'x', start: '2026-03-02', days: 2, tickets: [], testRuns: [{ date: '2026-03-03', failing: 4, total: 10 }] };
  const days = burndown(sprint);
  assert.equal(days[0]!.casesFailing, null);
  assert.equal(days[1]!.casesFailing, 4);
  assert.match(burndownMarkdown(sprint), /\| 1 \| 2026-03-02 \| 0  \| 0 \| – \|/);
});

test('a one-day sprint has an even line of zero, not a division by zero', () => {
  const sprint: Sprint = { label: 'x', start: '2026-03-02', days: 1, tickets: [{ id: 'a', opened: '2026-03-02', closed: null }], testRuns: [] };
  assert.deepEqual(burndown(sprint).map((d) => d.ideal), [0]);
});

test('bad data is reported, not drawn', () => {
  const good = readSprint();
  const bad = (change: Partial<Sprint>) => checkSprint({ ...good, ...change });
  assert.match(bad({ tickets: [...good.tickets, { id: 'T-1', opened: '2026-03-02', closed: null }] })[0]!, /T-1: listed twice/);
  assert.match(bad({ tickets: [{ id: 'z', opened: '2026-03-05', closed: '2026-03-04' }] })[0]!, /z: closed 2026-03-04 is before it was opened 2026-03-05/);
  assert.match(bad({ testRuns: [...good.testRuns, { date: '2026-03-02', failing: 1, total: 2 }] })[0]!, /two test runs listed for one day/);
  assert.match(bad({ testRuns: [{ date: '2026-03-02', failing: 9, total: 3 }] })[0]!, /9 failing of 3 cases does not add up/);
  assert.match(bad({ start: '2026-03-07' })[0]!, /must be a weekday/);
  assert.match(bad({ days: 0 })[0]!, /days must be a whole number/);
  assert.match(bad({ tickets: [{ id: 'q', opened: '3 March', closed: null }] })[0]!, /dates must be real days written YYYY-MM-DD/);
  assert.match(bad({ start: '2026-02-30' })[0]!, /must be a weekday written YYYY-MM-DD/);
  assert.match(bad({ tickets: [{ id: 'q', opened: '2026-02-30', closed: null }] })[0]!, /dates must be real days/);
  assert.match(bad({ testRuns: [{ date: '2026-13-01', failing: 1, total: 2 }] })[0]!, /run date must be a real day/);
  assert.deepEqual(checkSprint({ ...good, tickets: undefined as never }), ['tickets and testRuns must both be lists']);
});

test('the closing line counts only tickets that were in the sprint at some point', () => {
  const sprint: Sprint = { label: 'x', start: '2026-03-02', days: 2, testRuns: [], tickets: [
    { id: 'before', opened: '2026-02-20', closed: '2026-02-27' },
    { id: 'in', opened: '2026-03-02', closed: null },
    { id: 'after', opened: '2026-03-06', closed: null },
  ] };
  assert.ok(burndownMarkdown(sprint).includes('1 of 1 tickets still open'));
});

test('the page shows every day, the bars and the carry-over line', () => {
  const md = burndownMarkdown(readSprint());
  assert.ok(md.includes('| 1 | 2026-03-02 | 10 ██████████ | 10 | 12 |  |'));
  assert.ok(md.includes('| 3 | 2026-03-04 | 10 ██████████ | 7.8 | 14 | tickets grew (+1); failing cases grew (+3) |'));
  assert.ok(md.includes('| 10 | 2026-03-13 | 2 ██ | 0 | 1 |  |'));
  assert.ok(md.includes('At the end of day 10: 2 of 13 tickets still open (they carry over) and 1 failing case.'));
});

test('docs/burndown.md is the current output (run npm run planning)', () => {
  assert.equal(fs.readFileSync(path.join(packageRoot, 'docs', 'burndown.md'), 'utf8'), burndownMarkdown(readSprint()));
});
