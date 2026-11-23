// Release notes for users, checked against the acceptance criteria. Each note says in plain words
// what changed for a customer and names the criteria it relies on. The check finds a note that
// promises something no test backs: no criterion cited, a criterion that does not exist, a criterion
// whose latest test result is not a pass, a figure the criteria never state, or wording a customer
// would not read. It runs as one more check in the gate ("release-notes"), so a note that lies blocks the release.

const isText = (v) => typeof v === 'string' && v.trim() !== '';

// An acceptance criterion is a row of the spec: "| BK-R42 | text |".
const CRITERION_ROW = /^\| ([A-Z][A-Z0-9]*-R\d+) \| (.+) \|\s*$/;
const CRITERION_ID = /^[A-Z][A-Z0-9]*-R\d+$/;

// Longest note a customer will read to the end.
export const MAX_NOTE_LENGTH = 280;

/**
 * Checks the shape of the notes file and returns it. Throws a message that names the field.
 * The rules about what a note may promise are in checkNotes.
 * @param {unknown} input
 */
export function validateNotes(input) {
  const fail = (msg) => { throw new Error(`notes file: ${msg}`); };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) fail('must be a JSON object with release and notes');
  const n = /** @type {Record<string, any>} */ (input);
  if (!isText(n.release)) fail('"release" must be a non-empty string');
  if (!Array.isArray(n.notes) || n.notes.length === 0) fail('"notes" must list at least one note');
  for (const [i, note] of n.notes.entries()) {
    if (!isText(note?.id)) fail(`notes[${i}] needs an "id"`);
    if (!isText(note.change)) fail(`note ${note.id}: "change" must name the change in a few words`);
    if (!isText(note.text)) fail(`note ${note.id}: "text" must be the sentence a customer reads`);
    if (!Array.isArray(note.criteria) || !note.criteria.every(isText)) fail(`note ${note.id}: "criteria" must be a list of criterion ids (it may be empty, and the check then says so)`);
  }
  const ids = n.notes.map((x) => x.id);
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice) fail(`note id ${twice} is used twice`);
  return n;
}

/**
 * The criteria in a spec file, with the sentence each one states.
 * @param {string} specMarkdown
 * @returns {Map<string, string>} criterion id to its text
 */
export function parseCriteria(specMarkdown) {
  const criteria = new Map();
  for (const line of String(specMarkdown).split(/\r?\n/)) {
    const m = CRITERION_ROW.exec(line);
    if (m) criteria.set(m[1], m[2]);
  }
  if (criteria.size === 0) throw new Error('criteria file: no rows like "| BK-R01 | the rule |" were found');
  return criteria;
}

const RESULTS = ['passed', 'failed', 'flaky', 'skipped'];
// When one criterion has several tests, the worst result stands.
const WORST_FIRST = ['failed', 'skipped', 'flaky', 'passed'];
const worse = (a, b) => (WORST_FIRST.indexOf(a) <= WORST_FIRST.indexOf(b) ? a : b);

/**
 * The result of every criterion named in the titles of a node:test run (TAP output): "ok 3 - BK-R42 a deposit ..."
 * A title that names several criteria counts for each of them. A test that is skipped or to do is not a pass.
 * @param {string} tap
 * @returns {Record<string, string>} criterion id to passed, failed or skipped
 */
export function fromNodeTap(tap) {
  /** @type {Record<string, string>} */
  const byCriterion = {};
  for (const line of String(tap).split(/\r?\n/)) {
    const m = /^\s*(not ok|ok) \d+ - (.*)$/.exec(line);
    if (!m) continue;
    const skipped = /# (SKIP|TODO)\b/i.test(m[2]);
    const result = m[1] === 'not ok' ? 'failed' : skipped ? 'skipped' : 'passed';
    for (const id of new Set(m[2].match(/\b[A-Z][A-Z0-9]*-R\d+\b/g) ?? [])) byCriterion[id] = byCriterion[id] ? worse(byCriterion[id], result) : result;
  }
  return byCriterion;
}

/**
 * The same, from a Mocha JSON report (what Cypress writes with --reporter json).
 * @param {any} report
 * @returns {Record<string, string>}
 */
export function fromMochaJson(report) {
  /** @type {Record<string, string>} */
  const byCriterion = {};
  const add = (title, result) => {
    for (const id of new Set(String(title).match(/\b[A-Z][A-Z0-9]*-R\d+\b/g) ?? [])) byCriterion[id] = byCriterion[id] ? worse(byCriterion[id], result) : result;
  };
  for (const t of report?.tests ?? []) add(t.fullTitle ?? t.title, t.state === 'passed' ? 'passed' : t.state === 'failed' ? 'failed' : 'skipped');
  for (const t of report?.pending ?? []) add(t.fullTitle ?? t.title, 'skipped');
  return byCriterion;
}

/**
 * Several result sets (API tests and UI tests) as one: the worst result for a criterion stands.
 * @param {Array<Record<string, string>>} sets
 */
export function mergeResults(sets) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const set of sets) for (const [id, result] of Object.entries(set)) out[id] = out[id] ? worse(out[id], result) : result;
  return out;
}

// What a customer would not read: a rule id, a status code, code in quotes, or a word from the API's own vocabulary.
/** @type {Array<[(text: string, stated: Set<string>) => boolean, string]>} */
const JARGON = [
  [(t) => /\b[A-Z][A-Z0-9]*-R\d+\b/.test(t), 'a criterion id'],
  [(t) => /`/.test(t), 'code in backticks'],
  // A code after a word such as status or error is always one. A bare code the API answers with is one too,
  // unless a cited criterion states that number ("up to 400 a day"); it is never part of a figure such as 2,500 or $400.
  [(t, stated) => /\b(?:HTTP|status|error|code)\s+[45]\d\d\b/i.test(t)
    || [...t.matchAll(/(?<![\d,.$])(?:400|401|403|404|409|422|429)(?![\d,]|\.\d)/g)].some((m) => !stated.has(m[0])), 'an HTTP status code'],
  [(t) => /\b(JSON|API|endpoint|payload|idempotency|idempotent|header|schema|UTC|SQL|ledger)\b/i.test(t), 'a technical word'],
];

/** Digits written the way a customer reads them, so "25,000.00" and "25000" are one figure. */
const figure = (token) => {
  const plain = token.replace(/,/g, '');
  return plain.includes('.') ? plain.replace(/\.?0+$/, '') : plain;
};
const FIGURES = /\d[\d,]*(?:\.\d+)?/g;
const figuresIn = (text) => new Set((String(text).match(FIGURES) ?? []).map(figure));

/**
 * What is wrong with the notes. Each problem names its note and has a code:
 *  no-criteria, unknown-criterion, not-passing, figure-not-in-criteria, jargon, too-long, wrong-release.
 * @param {unknown} notesInput
 * @param {{ criteria: Map<string, string>, results: Record<string, string>, version?: string }} evidence
 * @returns {Array<{ code: string, id: string, message: string }>}
 */
export function checkNotes(notesInput, { criteria, results, version }) {
  const notes = validateNotes(notesInput);
  /** @type {Array<{ code: string, id: string, message: string }>} */
  const problems = [];
  const add = (code, id, message) => problems.push({ code, id, message });
  if (version !== undefined && notes.release !== version) add('wrong-release', notes.release, `the notes are for ${notes.release}, but the gate is for ${version}`);
  for (const note of notes.notes) {
    const cited = [...new Set(/** @type {string[]} */ (note.criteria))];
    if (cited.length === 0) add('no-criteria', note.id, `note ${note.id} (${note.change}) cites no criterion, so nothing says it was tested`);
    for (const c of cited) {
      if (!CRITERION_ID.test(c) || !criteria.has(c)) { add('unknown-criterion', note.id, `note ${note.id} cites ${c}, which is not in the criteria`); continue; }
      const result = results[c];
      if (!RESULTS.includes(result)) add('not-passing', note.id, `note ${note.id} relies on ${c}, which has no test result`);
      else if (result !== 'passed') add('not-passing', note.id, `note ${note.id} relies on ${c}, whose latest result is ${result}`);
    }
    const known = cited.filter((c) => criteria.has(c));
    if (known.length) {
      const stated = new Set(known.flatMap((c) => [...figuresIn(criteria.get(c))]));
      for (const f of figuresIn(note.text)) if (!stated.has(f)) add('figure-not-in-criteria', note.id, `note ${note.id} says ${f}, which none of ${known.join(', ')} states`);
    }
    // Numbers in code (`422 daily_limit`) are statuses and names, not quantities a note may repeat.
    const statedFigures = new Set(known.flatMap((c) => [...figuresIn(String(criteria.get(c)).replace(/`[^`]*`/g, ' '))]));
    for (const [found, what] of JARGON) if (found(note.text, statedFigures)) add('jargon', note.id, `note ${note.id} has ${what}; a customer would not read it`);
    if (note.text.length > MAX_NOTE_LENGTH) add('too-long', note.id, `note ${note.id} is ${note.text.length} characters; keep it to ${MAX_NOTE_LENGTH}`);
  }
  return problems;
}

/**
 * The notes as one check for the gate.
 * @param {unknown} notesInput
 * @param {Parameters<typeof checkNotes>[1]} evidence
 */
export function fromNotes(notesInput, evidence) {
  const problems = checkNotes(notesInput, evidence);
  const release = /** @type {any} */ (notesInput).release;
  return {
    name: 'release-notes',
    kind: 'check',
    passed: problems.length === 0,
    detail: problems.length === 0
      ? `${/** @type {any} */ (notesInput).notes.length} note(s) for ${release}, every claim backed by a passing test`
      : `${problems.length} problem(s): ${problems.slice(0, 3).map((p) => p.message).join('; ')}${problems.length > 3 ? `; and ${problems.length - 3} more` : ''}`,
  };
}

const cell = (text) => String(text).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();

/**
 * The notes a customer reads: one line each, in the order given. Only written when the check passes,
 * so a note that lies is never published.
 * @param {unknown} notesInput
 */
export function formatReleaseNotes(notesInput) {
  const notes = validateNotes(notesInput);
  return [`# What is new in ${notes.release}`, '', ...notes.notes.map((n) => `- ${n.text.trim().replace(/\s*\n\s*/g, ' ')}`), ''].join('\n');
}

/**
 * The check shown to the person who wrote the notes: each note, what it relies on, and what is wrong.
 * @param {unknown} notesInput
 * @param {Parameters<typeof checkNotes>[1]} evidence
 */
export function formatNotesReport(notesInput, evidence) {
  const notes = validateNotes(notesInput);
  const problems = checkNotes(notes, evidence);
  const lines = [
    `# Release notes check: ${cell(notes.release)}`,
    '',
    `**${notes.notes.length - new Set(problems.map((p) => p.id)).size} of ${notes.notes.length} notes are backed by passing tests.** ${problems.length === 0 ? 'Nothing is promised that was not tested.' : `${problems.length} problem(s) to fix.`}`,
    '',
    '| Note | Change | Relies on | Result |',
    '|---|---|---|---|',
    ...notes.notes.map((n) => {
      const bad = problems.filter((p) => p.id === n.id);
      return `| ${cell(n.id)} | ${cell(n.change)} | ${n.criteria.length ? cell(n.criteria.join(', ')) : '**nothing**'} | ${bad.length ? `**${[...new Set(bad.map((p) => p.code))].join(', ')}**` : 'backed'} |`;
    }),
    '',
    '## Problems',
    '',
    ...(problems.length ? problems.map((p) => `- \`${p.code}\`: ${cell(p.message)}`) : ['- None.']),
    '',
  ];
  return lines.join('\n');
}
