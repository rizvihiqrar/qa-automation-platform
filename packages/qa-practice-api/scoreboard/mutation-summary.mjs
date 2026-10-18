// Summarises Stryker's JSON reports (reports/mutation/<tests>.json, see
// stryker.config.mjs) as Markdown: the score per test set, the two sets combined,
// and every mutant that survived both, so a run says what the tests don't check.
//
//   node scoreboard/mutation-summary.mjs [reports folder]
//
// "Combined" is worked out from the designed and properties reports: a mutant is
// detected when either set detects it (matched by file, position and change), which
// is what running both would give, without a third run of the whole suite.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] ?? fileURLToPath(new URL('../reports/mutation/', import.meta.url));
const DETECTED = ['Killed', 'Timeout'];
const COUNTED = [...DETECTED, 'Survived', 'NoCoverage'];

// One entry per mutant Stryker could run (compile errors and ignored ones aside).
export function mutants(report) {
  return Object.entries(report.files).flatMap(([file, { mutants: list }]) => list
    .filter((m) => COUNTED.includes(m.status))
    .map((m) => ({
      key: `${file}:${m.location.start.line}:${m.location.start.column}:${m.mutatorName}:${m.replacement ?? ''}`,
      file: file.replaceAll('\\', '/'),
      line: m.location.start.line,
      mutator: m.mutatorName,
      replacement: m.replacement ?? '',
      detected: DETECTED.includes(m.status),
    })));
}

export function combine(a, b) {
  const byKey = new Map(b.map((m) => [m.key, m]));
  return a.map((m) => ({ ...m, detected: m.detected || Boolean(byKey.get(m.key)?.detected) }));
}

const score = (list) => {
  const detected = list.filter((m) => m.detected).length;
  return { total: list.length, detected, survived: list.length - detected, score: (100 * detected) / list.length };
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const sets = {};
  for (const name of ['designed', 'properties']) {
    const file = path.join(dir, `${name}.json`);
    if (existsSync(file)) sets[name] = mutants(JSON.parse(readFileSync(file, 'utf8')));
  }
  if (sets.designed && sets.properties) sets.combined = combine(sets.designed, sets.properties);

  console.log('| Tests | Mutants | Detected | Survived | Score |\n|---|---:|---:|---:|---:|');
  for (const [name, list] of Object.entries(sets)) {
    const s = score(list);
    console.log(`| ${name} | ${s.total} | ${s.detected} | ${s.survived} | ${s.score.toFixed(1)}% |`);
  }
  if (sets.combined) {
    const only = (a, b) => a.filter((m, i) => m.detected && !b[i].detected).length;
    const props = combine(sets.designed.map((m) => ({ ...m, detected: false })), sets.properties);
    console.log(`\nDetected only by the designed cases: ${only(sets.designed, props)}. Only by the properties: ${only(props, sets.designed)}.`);
  }
  const last = sets.combined ?? Object.values(sets)[0] ?? [];
  const survivors = last.filter((m) => !m.detected);
  console.log(`\n### Survived (${survivors.length})\n`);
  for (const m of survivors) console.log(`- \`${m.file}:${m.line}\` ${m.mutator}: \`${m.replacement.replace(/\s+/g, ' ').slice(0, 100)}\``);
}
