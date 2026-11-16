import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseSession, measureSession, newSessionTemplate } from '../src/session.js';
import { summarizeSessions, formatDebrief } from '../src/debrief.js';
import { loadSessions, main } from '../src/cli.js';
import { fileURLToPath } from 'node:url';

const SESSIONS = fileURLToPath(new URL('../sessions/', import.meta.url));
const read = (f) => fs.readFileSync(new URL(`../sessions/${f}`, import.meta.url), 'utf8');
const measured = (f) => measureSession(parseSession(read(f), f));

test('parseSession reads the charter, fields and tagged, timed notes', () => {
  const s = parseSession(read('2026-10-16-checkout-discounts.md'));
  assert.match(s.charter, /^Explore checkout discount codes/);
  assert.deepEqual([s.tester, s.area, s.timebox, s.started], ['QA', 'Checkout', 60, '2026-10-16T09:00']);
  assert.equal(s.notes.length, 7);
  assert.deepEqual(s.notes[1], { time: '09:11', tag: 'BUG', text: '" SAVE10" with a leading space is accepted, but no discount is applied and no message is shown.' });
});

test('untagged and untimed note lines still count, as NOTE', () => {
  const s = parseSession('# Charter: x\n## Notes\n[9:05] something\njust text\n- [10:00] bug: lower-case tag');
  assert.deepEqual(s.notes.map((n) => [n.time, n.tag]), [['09:05', 'NOTE'], [null, 'NOTE'], ['10:00', 'BUG']]);
});

test('an on-time session: duration, counts, first bug, bug rate', () => {
  const m = measured('2026-10-16-checkout-discounts.md');
  assert.equal(m.duration, 58);
  assert.equal(m.pace, 'on time');
  assert.deepEqual(m.counts, { BUG: 2, ISSUE: 0, QUESTION: 1, IDEA: 1, RISK: 1, NOTE: 2 });
  assert.equal(m.timeToFirstBug, 11);
  assert.equal(m.bugsPerHour, 2.1);
  assert.deepEqual(m.warnings, []);
});

test('a session that ran over its timebox is flagged with the overrun', () => {
  const m = measured('2026-10-16-inventory-sorting.md');
  assert.equal(m.duration, 57);
  assert.equal(m.pace, 'over');
  assert.deepEqual(m.warnings, ['ran 12 min over the 45 min timebox']);
  assert.deepEqual(m.issues, ['Staging product data was reset mid-session; lost 10 minutes re-creating test products.']);
});

test('a vague, short session gets hygiene warnings', () => {
  const m = measured('2026-10-16-login.md');
  assert.equal(m.pace, 'short');
  assert.equal(m.bugsPerHour, 0);
  assert.equal(m.timeToFirstBug, null);
  assert.equal(m.warnings.length, 3);
  assert.match(m.warnings[0], /charter is vague/);
  assert.equal(m.warnings[1], 'no area');
  assert.equal(m.warnings[2], '1 note(s) without a time');
});

test('summarizeSessions totals time, bugs, areas, questions and blockers', () => {
  const t = summarizeSessions(loadSessions(SESSIONS));
  assert.deepEqual(
    [t.sessions, t.minutes, t.bugs, t.bugsPerHour, t.overTimebox, t.withWarnings],
    [3, 129, 3, 1.4, 1, 2],
  );
  assert.deepEqual(t.areas, ['Checkout', 'Inventory']);
  assert.equal(t.openQuestions.length, 2);
  assert.equal(t.blockers.length, 1);
});

test('formatDebrief lists sessions, bugs, questions, blockers and hygiene', () => {
  const md = formatDebrief(loadSessions(SESSIONS));
  assert.match(md, /^# Exploratory testing debrief\n\n3 session\(s\), 129 min, 3 bug\(s\), 1\.4 bugs\/hour/);
  assert.match(md, /\| Inventory \| 57 \/ 45 min \| over \| 1 \| 1 \| 28 min \|/);
  assert.match(md, /## Open questions for the team\n- Should codes be case-insensitive\?/);
  assert.match(md, /## Session hygiene\n- \*\*2026-10-16-inventory-sorting\.md:\*\* ran 12 min over/);
});

test('a missing start time leaves duration unknown instead of guessing', () => {
  const m = measureSession(parseSession('# Charter: Explore a thing with a method to find a risk\n**Timebox:** 30\n## Notes\n[09:10] BUG: x'));
  assert.equal(m.duration, null);
  assert.equal(m.pace, null);
  assert.equal(m.bugsPerHour, null);
});

test('newSessionTemplate needs a charter and round-trips through the parser', () => {
  // @ts-expect-error the charter is left out on purpose to test the error
  assert.throws(() => newSessionTemplate({}), /charter is required/);
  const text = newSessionTemplate({ charter: 'Explore refunds with partial amounts to find rounding errors', area: 'Payments', tester: 'QA', timebox: 45, started: '2026-10-17T14:00' });
  const s = parseSession(text);
  assert.deepEqual([s.charter, s.area, s.timebox, s.started], ['Explore refunds with partial amounts to find rounding errors', 'Payments', 45, '2026-10-17T14:00']);
  assert.deepEqual(s.notes, [{ time: '14:00', tag: 'NOTE', text: 'Session started' }]);
});

test('the CLI main rejects unknown commands and missing folders', () => {
  assert.throws(() => main([]), /Commands:/);
  assert.throws(() => main(['debrief']), /Usage: debrief/);
  assert.match(main(['debrief', SESSIONS]), /3 session\(s\)/);
});

// A162: three real sessions on the qa-practice-api product list (not made up, unlike the
// sample sessions above). The numbers below were counted by hand from the session files and
// are the same ones the write-up in docs/ and the tests in qa-practice-api quote.
const REAL = SESSIONS + 'qa-practice-api';
const real = () => loadSessions(REAL);
const ids = (notes) => notes.map((t) => t.match(/EX-\d\d/)?.[0]);

test('the real qa-practice-api sessions: 3 sessions, 5 bugs, 6 questions, 1 risk', () => {
  const sessions = real();
  assert.deepEqual(sessions.map((s) => s.source), ['2026-11-16-category-filter.md', '2026-11-16-filter-counts.md', '2026-11-16-pagination.md']);
  const total = (tag) => sessions.reduce((n, s) => n + s.counts[tag], 0);
  assert.deepEqual([total('BUG'), total('QUESTION'), total('RISK'), total('ISSUE')], [5, 6, 1, 0]);
  assert.deepEqual(summarizeSessions(sessions).areas.length, 3);
});

test('the real sessions: edge cases found per charter (bugs + questions + risks) are 4, 5 and 3', () => {
  const found = Object.fromEntries(real().map((s) => [s.source, s.counts.BUG + s.counts.QUESTION + s.counts.RISK]));
  assert.deepEqual(found, { '2026-11-16-category-filter.md': 4, '2026-11-16-pagination.md': 5, '2026-11-16-filter-counts.md': 3 });
});

test('the real sessions: every bug and risk carries its EX id, and the ids are the ones the tests pin', () => {
  const parsed = fs.readdirSync(REAL).map((f) => parseSession(fs.readFileSync(`${REAL}/${f}`, 'utf8'), f));
  const tagged = (tag) => parsed.flatMap((s) => s.notes.filter((n) => n.tag === tag).map((n) => n.text));
  const [bugs, risks] = [tagged('BUG'), tagged('RISK')];
  assert.deepEqual(ids(bugs).sort(), ['EX-01', 'EX-02', 'EX-03', 'EX-05', 'EX-06']);
  assert.deepEqual(ids(risks), ['EX-04']);
});

test('the real sessions ran in under a minute each, so the minute clock reads 0 and the sessions count as short', () => {
  for (const s of real()) assert.deepEqual([s.duration, s.timebox, s.pace, s.warnings], [0, 10, 'short', []], s.source);
});
