// A one-page go / no-go memo for a reader who does not read test reports.
// The decision, the checks and the reasons come from the gate's outcome and are
// never taken from the release file, so a memo cannot say GO when the gate said NO-GO.

const STATUS_WORDS = { pass: 'Passed', fail: 'Failed', missing: 'Did not run' };

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isTextList = (v) => Array.isArray(v) && v.every(isText);

/**
 * Checks the hand-written release file and returns it. Throws a message that names the field.
 * @param {unknown} input
 */
export function validateRelease(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('release file: must be a JSON object with the fields version, date, summary, changes, risks and signOff');
  const r = /** @type {Record<string, any>} */ (input);
  if ('decision' in r) throw new Error('release file: "decision" is not allowed here, the memo takes it from the gate');
  if (!isText(r.version)) throw new Error('release file: "version" must be a non-empty string');
  if (!isText(r.date)) throw new Error('release file: "date" must be a non-empty string');
  if (!isText(r.summary)) throw new Error('release file: "summary" must be one plain sentence or two');
  if (!isTextList(r.changes) || r.changes.length === 0) throw new Error('release file: "changes" must list at least one change');
  if (!isTextList(r.risks)) throw new Error('release file: "risks" must be a list (it may be empty)');
  if (!isTextList(r.signOff) || r.signOff.length === 0) throw new Error('release file: "signOff" must list at least one role');
  if (r.readyWhen !== undefined && !isTextList(r.readyWhen)) throw new Error('release file: "readyWhen" must be a list of text');
  if (r.madeReady !== undefined && !isText(r.madeReady)) throw new Error('release file: "madeReady" must be text');
  return r;
}

const bullets = (items) => items.map((i) => `- ${oneLine(i)}`);
// A pipe or a line break inside a table cell would split the row.
// Free text goes in on one line, so a line break cannot start a heading or a table of its own.
const oneLine = (text) => String(text).replace(/\s*\n\s*/g, ' ').trim();
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/**
 * @param {{ decision: string, reasons: string[], checks: Array<{ name: string, status: string, detail: string }> }} outcome
 * @param {Record<string, any>} releaseInput
 */
export function formatMemo(outcome, releaseInput) {
  const r = validateRelease(releaseInput);
  const go = outcome.decision === 'go';
  const lines = [
    `# Release memo: ${r.version}`,
    '',
    `**Decision: ${go ? '✅ GO, the release can go out' : '⛔ NO-GO, the release is not ready'}**`,
    '',
    `Date: ${r.date}`,
    '',
    '## Summary',
    '',
    oneLine(r.summary),
    '',
    '## What changed',
    '',
    ...bullets(r.changes),
    '',
    '## What was tested',
    '',
    '| Check | Result | Detail |',
    '|---|---|---|',
    ...outcome.checks.map((c) => `| ${cell(c.name)} | ${STATUS_WORDS[c.status] ?? c.status} | ${cell(c.detail)} |`),
    '',
  ];

  if (!go) {
    lines.push('## Why it is not ready', '', ...bullets(outcome.reasons), '');
    if (r.readyWhen?.length) lines.push('## What has to happen first', '', ...bullets(r.readyWhen), '');
  } else if (r.madeReady) {
    lines.push('## What made it ready', '', oneLine(r.madeReady), '');
  }

  lines.push(
    '## Known risks',
    '',
    ...(r.risks.length ? bullets(r.risks) : ['- None known at the time of the decision.']),
    '',
    '## Sign-off',
    '',
    `${go ? 'Each role below confirms the release can go out.' : 'Each role below confirms the release must wait.'}`,
    '',
    '| Role | Name | Date |',
    '|---|---|---|',
    ...r.signOff.map((role) => `| ${cell(role)} | | |`),
  );
  return lines.join('\n') + '\n';
}
