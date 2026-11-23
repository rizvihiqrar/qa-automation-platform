import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  checkNotes, formatNotesReport, formatReleaseNotes, fromMochaJson, fromNodeTap, fromNotes, mergeResults, parseCriteria, validateNotes, MAX_NOTE_LENGTH,
} from '../src/notes.js';
import { decide } from '../src/gate.js';
import { parseArgs, run } from '../src/cli.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const here = (...p) => fileURLToPath(new URL(path.posix.join('..', ...p), import.meta.url));
const read = (...p) => fs.readFileSync(here(...p), 'utf8');
const valid = () => JSON.parse(read('examples', 'notes-1.4.1.json'));
const criteria = () => parseCriteria(read('examples', 'criteria-banking.md'));
const goodResults = () => mergeResults([fromNodeTap(read('examples', 'results-api.tap')), fromMochaJson(JSON.parse(read('examples', 'results-ui.json')))]);
const evidence = (results = goodResults()) => ({ criteria: criteria(), results });
const codes = (notes, ev = evidence()) => checkNotes(notes, ev).map((p) => p.code);
const note = (notes, id) => notes.notes.find((n) => n.id === id);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));

test('the committed example notes have no problems (no false alert on good notes)', () => {
  assert.deepEqual(checkNotes(valid(), evidence()), []);
  const check = fromNotes(valid(), evidence());
  assert.equal(check.passed, true);
  assert.equal(check.detail, '4 note(s) for 1.4.1, every claim backed by a passing test');
});

// Each mutation puts one known fault into the good notes (or the evidence). The check has to name it.
/** @type {Array<[string, string, (n: any, ev: any) => void]>} */
const SEEDED = [
  ['no-criteria', 'a note cites no criterion', (n) => { note(n, 'N1').criteria = []; }],
  ['unknown-criterion', 'a note cites a criterion that is not in the spec', (n) => { note(n, 'N2').criteria = ['BK-R99']; }],
  ['unknown-criterion', 'a note cites something that is not a criterion id at all', (n) => { note(n, 'N2').criteria = ['the daily limit']; }],
  ['not-passing', 'the criterion a note relies on has a failing test', (n, ev) => { ev.results['BK-R40'] = 'failed'; }],
  ['not-passing', 'the criterion a note relies on has no test result', (n, ev) => { delete ev.results['BK-R44']; }],
  ['not-passing', 'the criterion a note relies on is skipped', (n, ev) => { ev.results['BK-R42'] = 'skipped'; }],
  ['not-passing', 'the criterion a note relies on passed only on a retry', (n, ev) => { ev.results['BK-R37'] = 'flaky'; }],
  ['not-passing', 'a result that is not one of the known words', (n, ev) => { ev.results['BK-R40'] = 'ok'; }],
  ['figure-not-in-criteria', 'a note promises a bigger daily limit than the criterion states', (n) => { note(n, 'N1').text = 'You can send up to 30,000 a day.'; }],
  ['figure-not-in-criteria', 'a note promises a figure the criteria never mention', (n) => { note(n, 'N2').text = 'Cash deposits of CAD 5,000 or more are reported.'; }],
  ['jargon', 'a note names a rule id', (n) => { note(n, 'N3').text = 'Sanctions screening (BK-R44) stops a payment.'; }],
  ['jargon', 'a note shows an HTTP status', (n) => { note(n, 'N3').text = 'A payment to a listed person is refused with a 422.'; }],
  ['jargon', 'a note has code in backticks', (n) => { note(n, 'N3').text = 'A payment gets `screening_hold`.'; }],
  ['jargon', 'a note uses API words', (n) => { note(n, 'N3').text = 'The JSON reply no longer names the person.'; }],
  ['wrong-release', 'the notes are for another release than the gate', (n, ev) => { ev.version = '1.4.0'; }],
  ['too-long', 'a note is longer than a customer reads', (n) => { note(n, 'N3').text = `A payment to a person on a sanctions list is stopped. ${'The message never says why. '.repeat(12)}`; }],
];
for (const [code, what, mutate] of SEEDED) {
  test(`seeded fault: ${what} is reported as ${code}`, () => {
    const notes = valid();
    const ev = evidence({ ...goodResults() });
    mutate(notes, ev);
    assert.ok(codes(notes, ev).includes(code), `expected ${code}, got ${codes(notes, ev).join(', ') || 'nothing'}`);
    assert.equal(fromNotes(notes, ev).passed, false);
  });
}

test('a fault is reported against the note that has it, and only that note', () => {
  const notes = valid();
  note(notes, 'N2').criteria = [];
  const problems = checkNotes(notes, evidence());
  assert.deepEqual(problems.map((p) => [p.code, p.id]), [['no-criteria', 'N2']]);
});

test('a criterion with no test result is told apart from one whose test failed', () => {
  const ev = evidence({ ...goodResults() });
  delete ev.results['BK-R44'];
  ev.results['BK-R40'] = 'skipped';
  const messages = checkNotes(valid(), ev).map((p) => p.message);
  assert.deepEqual(messages, ['note N1 relies on BK-R40, whose latest result is skipped', 'note N3 relies on BK-R44, which has no test result']);
});

test('the release the notes are for is compared with the gate version only when a version is given', () => {
  assert.deepEqual(checkNotes(valid(), { ...evidence(), version: '1.4.1' }), []);
  const problems = checkNotes(valid(), { ...evidence(), version: '1.4.2' });
  assert.deepEqual(problems.map((p) => p.code), ['wrong-release']);
  assert.equal(problems[0].message, 'the notes are for 1.4.1, but the gate is for 1.4.2');
});

test('a bare number that looks like a status code is allowed when a cited rule states it, and flagged when none does', () => {
  const notes = { release: '1.0', notes: [{ id: 'N1', change: 'x', text: 'You can make up to 400 transfers a day.', criteria: ['BK-R05'] }] };
  const own = (rule) => ({ criteria: new Map([['BK-R05', rule]]), results: { 'BK-R05': 'passed' } });
  assert.deepEqual(checkNotes(notes, own('An account may make up to 400 transfers a day.')), []);
  assert.deepEqual(checkNotes(notes, own('An account may make a limited number of transfers a day.')).map((p) => p.code), ['figure-not-in-criteria', 'jargon']);
  // A number a rule writes only as a status code (in backticks) is still a status code in a note.
  assert.ok(checkNotes(notes, own('A refused transfer is `400 bad_request`; an account may make a limited number a day.')).some((p) => p.code === 'jargon'));
  // After a word such as status or error it is a code whatever the rules say.
  notes.notes[0].text = 'You will see error 400 when you make more than 400 transfers a day.';
  assert.ok(checkNotes(notes, own('An account may make up to 400 transfers a day.')).some((p) => p.code === 'jargon'));
});

test('the report names each kind of problem once in a note, however many times it happens', () => {
  const notes = valid();
  note(notes, 'N1').text = 'You can send up to 30,000 or 40,000 a day.';
  const md = formatNotesReport(notes, evidence());
  assert.match(md, /\| N1 \|.*\| \*\*figure-not-in-criteria\*\* \|/);
  assert.equal(checkNotes(notes, evidence()).filter((p) => p.code === 'figure-not-in-criteria').length, 2);
});

test('a note that cites a criterion twice is checked once', () => {
  const notes = valid();
  note(notes, 'N1').criteria = ['BK-R40', 'BK-R40'];
  assert.deepEqual(checkNotes(notes, evidence()), []);
  const ev = evidence({ ...goodResults(), 'BK-R40': 'failed' });
  assert.equal(checkNotes(notes, ev).filter((p) => p.code === 'not-passing').length, 1);
});

test('a note that cites one good and one failing criterion is blocked by the failing one', () => {
  const notes = valid();
  const ev = evidence({ ...goodResults(), 'BK-R37': 'failed' });
  const problems = checkNotes(notes, ev);
  assert.deepEqual(problems.map((p) => [p.code, p.id]), [['not-passing', 'N4']]);
  assert.match(problems[0].message, /BK-R37, whose latest result is failed/);
});

test('figures are compared as a customer reads them: 25,000 matches 25,000.00 and 25000', () => {
  const notes = valid();
  for (const text of ['Send up to 25,000 a day.', 'Send up to 25000 a day.', 'Send up to 25,000.00 a day.', 'Send up to 25000.0 a day.']) {
    note(notes, 'N1').text = text;
    assert.deepEqual(codes(notes), [], text);
  }
  note(notes, 'N1').text = 'Send up to 2,500 a day.';
  assert.deepEqual(codes(notes), ['figure-not-in-criteria']);
  // 25,000.50 is not 25,000, and a figure that merely contains the digits does not match.
  note(notes, 'N1').text = 'Send up to 25,000.50 a day.';
  assert.deepEqual(codes(notes), ['figure-not-in-criteria']);
  note(notes, 'N1').text = 'Send up to 5,000 a day.';
  assert.deepEqual(codes(notes), ['figure-not-in-criteria']);
});

test('a figure is looked for only in the criteria the note cites, not in the whole spec', () => {
  const notes = valid();
  note(notes, 'N2').text = 'You can send up to 25,000 a day.'; // 25,000 is in BK-R40, but N2 cites BK-R42
  assert.deepEqual(codes(notes), ['figure-not-in-criteria']);
});

test('a note at exactly the length limit is allowed and one character more is not', () => {
  const notes = valid();
  note(notes, 'N3').text = `A payment to a person on a sanctions list is stopped.${' x'.repeat(200)}`.slice(0, MAX_NOTE_LENGTH);
  assert.equal(note(notes, 'N3').text.length, MAX_NOTE_LENGTH);
  assert.deepEqual(codes(notes), []);
  note(notes, 'N3').text += 'x';
  assert.deepEqual(codes(notes), ['too-long']);
});

test('jargon words are caught as words, not inside other words', () => {
  const notes = valid();
  note(notes, 'N3').text = 'A payment to a person on a sanctions list is stopped, and we keep a pipeline of apis private.'; // "apis" is not "API"; "pipeline" has no jargon
  assert.deepEqual(codes(notes), []);
  note(notes, 'N3').text = 'The API stops a payment to a listed person.';
  assert.deepEqual(codes(notes), ['jargon']);
  // A figure that looks like a status code is not one: 2,500 and $400 are amounts.
  note(notes, 'N1').text = 'You can send up to 25,000 a day, and 2,500 or $400 is fine too.';
  assert.deepEqual(codes(notes).filter((c) => c === 'jargon'), ['jargon']); // only N3's API word
  assert.deepEqual(checkNotes(notes, evidence()).filter((p) => p.code === 'jargon').map((p) => p.id), ['N3']);
});

test('validateNotes names the field that is wrong', () => {
  const broken = (mutate) => { const n = valid(); mutate(n); return n; };
  assert.throws(() => validateNotes(null), /notes file: must be a JSON object/);
  assert.throws(() => validateNotes([]), /notes file: must be a JSON object/);
  assert.throws(() => validateNotes(broken((n) => { n.release = ''; })), /"release"/);
  assert.throws(() => validateNotes(broken((n) => { n.notes = []; })), /"notes" must list at least one note/);
  assert.throws(() => validateNotes(broken((n) => { delete note(n, 'N1').id; })), /notes\[0\] needs an "id"/);
  assert.throws(() => validateNotes(broken((n) => { note(n, 'N1').change = ' '; })), /note N1: "change"/);
  assert.throws(() => validateNotes(broken((n) => { note(n, 'N1').text = 3; })), /note N1: "text"/);
  assert.throws(() => validateNotes(broken((n) => { note(n, 'N1').criteria = 'BK-R40'; })), /note N1: "criteria" must be a list/);
  assert.throws(() => validateNotes(broken((n) => { note(n, 'N1').criteria = [4]; })), /note N1: "criteria" must be a list/);
  assert.throws(() => validateNotes(broken((n) => { note(n, 'N2').id = 'N1'; })), /note id N1 is used twice/);
});

test('parseCriteria reads rule rows, with Windows line endings, and refuses a file with none', () => {
  const c = parseCriteria('# x\n\n| Rule | Says |\n|---|---|\n| BK-R01 | one |\r\n| BK-R02 | two \\| pipe |\r\n| not a rule | no |\n');
  assert.deepEqual([...c.keys()], ['BK-R01', 'BK-R02']);
  assert.equal(c.get('BK-R01'), 'one');
  assert.throws(() => parseCriteria('nothing here'), /criteria file: no rows/);
  assert.throws(() => parseCriteria(''), /criteria file: no rows/);
});

test('the example criteria file holds the five rules the notes cite, word for word from the banking spec', () => {
  assert.deepEqual([...criteria().keys()], ['BK-R34', 'BK-R37', 'BK-R40', 'BK-R42', 'BK-R44']);
  const spec = fs.readFileSync(here('..', 'banking-api', 'SPEC.md'), 'utf8').replace(/\r\n/g, '\n');
  for (const [id, text] of criteria()) assert.ok(spec.includes(`| ${id} | ${text} |`), `${id} differs from banking-api/SPEC.md`);
});

test('fromNodeTap reads nested tests, failures, skips, to-dos and a title with several criteria', () => {
  const tap = [
    'TAP version 13',
    'ok 1 - BK-R01 one',
    '    not ok 1 - BK-R02 two',
    '    ok 2 - BK-R02 two again',
    'ok 2 - BK-R03 three # SKIP not now',
    'ok 3 - BK-R04 four # TODO later',
    'ok 4 - BK-R05 and BK-R06 together, BK-R05 named twice',
    'ok 5 - a test with no criterion',
    'not ok 6 - OTHER-R7 a different spec',
    '  # not ok 99 - BK-R77 a comment, not a result',
    '# pass 3',
  ].join('\n');
  assert.deepEqual(fromNodeTap(tap), { 'BK-R01': 'passed', 'BK-R02': 'failed', 'BK-R03': 'skipped', 'BK-R04': 'skipped', 'BK-R05': 'passed', 'BK-R06': 'passed', 'OTHER-R7': 'failed' });
  assert.deepEqual(fromNodeTap(''), {});
});

test('fromNodeTap: when one criterion has several tests, the worst result stands, in either order', () => {
  assert.equal(fromNodeTap('ok 1 - BK-R01 a\nnot ok 2 - BK-R01 b')['BK-R01'], 'failed');
  assert.equal(fromNodeTap('not ok 1 - BK-R01 a\nok 2 - BK-R01 b')['BK-R01'], 'failed');
  assert.equal(fromNodeTap('ok 1 - BK-R01 a\nok 2 - BK-R01 b # SKIP')['BK-R01'], 'skipped');
});

test('fromMochaJson reads passed, failed and pending tests, and ignores tests that name no criterion', () => {
  const report = { tests: [
    { fullTitle: 'x BK-R01 a', state: 'passed' },
    { fullTitle: 'x BK-R02 b', state: 'failed' },
    { fullTitle: 'x BK-R03 c', state: 'pending' },
    { title: 'BK-R04 d', state: 'passed' },
    { fullTitle: 'no criterion', state: 'failed' },
  ], pending: [{ fullTitle: 'x BK-R05 e' }] };
  assert.deepEqual(fromMochaJson(report), { 'BK-R01': 'passed', 'BK-R02': 'failed', 'BK-R03': 'skipped', 'BK-R04': 'passed', 'BK-R05': 'skipped' });
  assert.deepEqual(fromMochaJson({}), {});
  assert.deepEqual(fromMochaJson(null), {});
});

test('mergeResults keeps the worst result for a criterion across the API tests and the UI tests', () => {
  assert.deepEqual(mergeResults([{ 'BK-R01': 'passed', 'BK-R02': 'passed' }, { 'BK-R01': 'failed' }]), { 'BK-R01': 'failed', 'BK-R02': 'passed' });
  assert.deepEqual(mergeResults([{ 'BK-R01': 'failed' }, { 'BK-R01': 'passed' }]), { 'BK-R01': 'failed' });
  assert.deepEqual(mergeResults([{ 'BK-R01': 'skipped' }, { 'BK-R01': 'passed' }]), { 'BK-R01': 'skipped' });
  assert.deepEqual(mergeResults([]), {});
});

test('the notes are one more check in the gate: a failing claim gives NO-GO and a good set gives GO', () => {
  const policy = { requiredChecks: ['release-notes'], maxFailedTests: 0, maxFlakyTests: 0 };
  assert.equal(decide(policy, [fromNotes(valid(), evidence())]).decision, 'go');
  const bad = valid();
  note(bad, 'N1').criteria = [];
  const outcome = decide(policy, [fromNotes(bad, evidence())]);
  assert.equal(outcome.decision, 'no-go');
  assert.match(JSON.stringify(outcome), /cites no criterion/);
  // And a gate that requires the check does not pass when the check never ran.
  assert.equal(decide(policy, []).decision, 'no-go');
});

test('the detail line names the first three problems and counts the rest', () => {
  const notes = valid();
  for (const id of ['N1', 'N2', 'N3', 'N4']) note(notes, id).criteria = [];
  const { detail, passed } = fromNotes(notes, evidence());
  assert.equal(passed, false);
  assert.match(detail, /^4 problem\(s\): .*; and 1 more$/);
});

test('formatReleaseNotes lists the customer sentences only, in order', () => {
  const md = formatReleaseNotes(valid());
  assert.match(md, /^# What is new in 1\.4\.1\n\n- You can send up to 25,000/);
  assert.equal(md.split('\n').filter((l) => l.startsWith('- ')).length, 4);
  assert.ok(!/BK-R|N1|Daily sending limit/.test(md), 'no internal id or change name reaches the customer');
  const multi = valid();
  note(multi, 'N1').text = 'Line one\n  line two.';
  assert.match(formatReleaseNotes(multi), /- Line one line two\./);
});

test('formatNotesReport shows each note, what it relies on, and the problems', () => {
  const ok = formatNotesReport(valid(), evidence());
  assert.match(ok, /\*\*4 of 4 notes are backed by passing tests\.\*\* Nothing is promised that was not tested\./);
  const notes = valid();
  note(notes, 'N1').criteria = [];
  note(notes, 'N2').text = 'Cash of CAD 9,000 is reported.';
  const ev = evidence({ ...goodResults(), 'BK-R37': 'failed' });
  const bad = formatNotesReport(notes, ev);
  assert.match(bad, /\*\*1 of 4 notes are backed by passing tests\.\*\* 3 problem\(s\) to fix\./);
  assert.match(bad, /\| N1 \| Daily sending limit \| \*\*nothing\*\* \| \*\*no-criteria\*\* \|/);
  assert.match(bad, /\| N2 \|.*\*\*figure-not-in-criteria\*\*/);
  assert.match(bad, /\| N4 \|.*\*\*not-passing\*\*/);
  assert.match(bad, /\| N3 \|.*\| backed \|/);
});

test('a pipe or a line break in a note cannot add a column or a row to the report', () => {
  const notes = valid();
  note(notes, 'N1').change = 'Limit | new\nline';
  const md = formatNotesReport(notes, evidence());
  const row = md.split('\n').find((l) => l.startsWith('| N1 |'));
  assert.equal(row.replace(/\\\|/g, '').split('|').length, 6);
  assert.match(row, /Limit \\\| new line/);
});

// The command line.
const args = (extra = []) => ['--notes', 'n.json', '--criteria', 'c.md', '--tap', 'a.tap', ...extra];
test('parseArgs: the notes check needs its criteria and at least one test result, and the other flags need the notes', () => {
  assert.doesNotThrow(() => parseArgs(args()));
  assert.deepEqual(parseArgs(args(['--tap', 'b.tap', '--mocha', 'u.json'])).tap, ['a.tap', 'b.tap']);
  assert.deepEqual(parseArgs(args(['--mocha', 'u.json'])).mocha, ['u.json']);
  assert.throws(() => parseArgs(['--notes', 'n.json', '--tap', 'a.tap']), /--notes needs --criteria/);
  assert.throws(() => parseArgs(['--notes', 'n.json', '--criteria', 'c.md']), /--notes needs test results/);
  assert.throws(() => parseArgs(['--criteria', 'c.md', '--k6', 'p=k.json']), /need --notes/);
  assert.throws(() => parseArgs(['--tap', 'a.tap', '--check', 'x=y.json']), /need --notes/);
  assert.throws(() => parseArgs(['--published', 'p.md', '--check', 'x=y.json']), /need --notes/);
  assert.throws(() => parseArgs(args(['--published'])), /--published needs a file path/);
  assert.throws(() => parseArgs(args(['--tap'])), /--tap needs a file path/);
  assert.throws(() => parseArgs(args(['--mocha', '--published', 'p.md'])), /--mocha needs a file path/);
  assert.equal(parseArgs(args(['--published', 'p.md', '--notes-report', 'r.md'])).notesReport, 'r.md');
});

const files = () => ({ notes: here('examples', 'notes-1.4.1.json'), criteria: here('examples', 'criteria-banking.md'), tap: here('examples', 'results-api.tap'), mocha: here('examples', 'results-ui.json'), policy: here('examples', 'policy-notes.json') });
const cliArgs = (f, dir, extra = []) => ['--policy', f.policy, '--notes', f.notes, '--criteria', f.criteria, '--tap', f.tap, '--mocha', f.mocha, '--published', path.join(dir, 'notes.md'), '--notes-report', path.join(dir, 'report.md'), ...extra];

test('the command line writes the customer notes and the report when every claim is backed, and exits 0', () => {
  const dir = tmp();
  const r = spawnSync(process.execPath, [CLI, ...cliArgs(files(), dir)], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /GO/);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.md'), 'utf8'), formatReleaseNotes(valid()));
  assert.match(fs.readFileSync(path.join(dir, 'report.md'), 'utf8'), /4 of 4 notes are backed/);
});

test('a claim without a passing test blocks the release, writes the report and no customer notes, and removes an old copy', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'notes.md'), 'an old, published copy');
  const f = files();
  const failing = path.join(dir, 'failing.tap');
  fs.writeFileSync(failing, read('examples', 'results-api.tap').replace('ok 1 - BK-R40', 'not ok 1 - BK-R40'));
  const r = spawnSync(process.execPath, [CLI, ...cliArgs({ ...f, tap: failing }, dir)], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /NO-GO/);
  assert.match(r.stdout, /BK-R40, whose latest result is failed/);
  assert.equal(fs.existsSync(path.join(dir, 'notes.md')), false, 'the old customer notes were left standing');
  assert.match(fs.readFileSync(path.join(dir, 'report.md'), 'utf8'), /\*\*not-passing\*\*/);
});

test('notes that are all backed are not published when another check blocks the release', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'notes.md'), 'an old, published copy');
  const failedContract = path.join(dir, 'contract.json');
  fs.writeFileSync(failedContract, JSON.stringify({ passed: false, summary: '1 of 20 responses do not match' }));
  const policy = path.join(dir, 'policy.json');
  fs.writeFileSync(policy, JSON.stringify({ requiredChecks: ['release-notes', 'contract'], maxFailedTests: 0, maxFlakyTests: 0 }));
  const r = spawnSync(process.execPath, [CLI, ...cliArgs({ ...files(), policy }, dir, ['--check', `contract=${failedContract}`])], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /NO-GO/);
  assert.match(r.stdout, /\| release-notes \| pass \|/, 'the notes themselves are fine');
  assert.equal(fs.existsSync(path.join(dir, 'notes.md')), false, 'notes for a blocked release were published');
  assert.match(fs.readFileSync(path.join(dir, 'report.md'), 'utf8'), /4 of 4 notes are backed/);
});

test('--version must match the release the notes are for', () => {
  const dir = tmp();
  const wrong = run(parseArgs(cliArgs(files(), dir, ['--version', '1.4.0'])));
  assert.equal(wrong.outcome.decision, 'no-go');
  assert.match(JSON.stringify(wrong.outcome), /the notes are for 1\.4\.1, but the gate is for 1\.4\.0/);
  assert.equal(wrong.published, null);
  assert.equal(run(parseArgs(cliArgs(files(), dir, ['--version', '1.4.1']))).outcome.decision, 'go');
});

test('a missing file is a failed check that says which file, not a crash, and still writes the report', () => {
  const dir = tmp();
  const f = files();
  const out = run(parseArgs(cliArgs({ ...f, tap: path.join(dir, 'nope.tap') }, dir)));
  assert.equal(out.outcome.decision, 'no-go');
  assert.match(JSON.stringify(out.outcome), /file not found: .*nope\.tap/);
  assert.equal(out.published, null);
  assert.match(out.notesReport, /The notes could not be checked: file not found/);
});

test('notes that cannot be read are a failed check that says why', () => {
  const dir = tmp();
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{"release":"1.0"}');
  const out = run(parseArgs(cliArgs({ ...files(), notes: bad }, dir)));
  assert.equal(out.outcome.decision, 'no-go');
  assert.match(out.outcome.checks[0].detail, /"notes" must list at least one note/);
  assert.equal(out.published, null);
  const notJson = path.join(dir, 'notjson.json');
  fs.writeFileSync(notJson, 'not json');
  assert.equal(run(parseArgs(cliArgs({ ...files(), notes: notJson }, dir))).outcome.decision, 'no-go');
});

test('the notes check runs beside the other checks and does not change them', () => {
  const dir = tmp();
  const out = run(parseArgs([...cliArgs(files(), dir), '--check', `contract=${here('examples', 'contract-1.4.1.json')}`, '--policy', here('examples', 'policy-notes.json')]));
  assert.deepEqual(out.outcome.checks.map((r) => r.name).sort(), ['contract', 'release-notes']);
});
