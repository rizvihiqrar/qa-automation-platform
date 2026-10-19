// Publishes the HTML test reports from one CI run next to the dashboard.
//
// CI uploads each suite's report as an artifact named report-<name>. This module
// copies them into the Pages site, one folder per report, and writes an index.
// Reports are public once published, so nothing is copied unchecked:
//   - Text files (HTML, JSON, Markdown...) have token-shaped strings replaced.
//     The Postman report, for example, shows the demo API's login responses,
//     which contain real (short-lived) access tokens.
//   - Playwright HTML reports keep their data in a zip embedded in the page, and
//     zips can't be patched in place. Their contents are unzipped and scanned;
//     a report that contains a token is withheld, not published.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { esc, day, PAGE_STYLE } from './render.js';

/** Strings that must never reach a public page. */
export const SECRET_PATTERNS = [
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: 'bearer token', re: /Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/g },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  // A Windows profile path carries the local user name (reports built on a laptop).
  { name: 'local user path', re: /\b[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/\s"'<>&]+/gi },
];

const TEXT_EXT = new Set(['.html', '.htm', '.json', '.md', '.txt', '.xml', '.csv', '.js', '.css', '.svg']);

/**
 * Replaces every secret-shaped string with a placeholder.
 * @param {string} text
 * @returns {{ text: string, redactions: number }}
 */
export function redact(text) {
  let redactions = 0;
  for (const { name, re } of SECRET_PATTERNS) {
    text = text.replace(re, () => { redactions += 1; return `[redacted ${name}]`; });
  }
  return { text, redactions };
}

/**
 * Names of the secret patterns found in a text.
 * @param {string} text
 * @returns {string[]}
 */
export function findSecrets(text) {
  return SECRET_PATTERNS.filter(({ re }) => { re.lastIndex = 0; return re.test(text); }).map(({ name }) => name);
}

/**
 * Reads every file in a zip archive as text. Supports stored and deflated
 * entries, which covers Playwright's reports and traces.
 * @param {Buffer} buf
 * @returns {Array<{ name: string, text: string }>}
 */
export function unzipTexts(buf) {
  // The end-of-central-directory record is in the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('not a zip archive');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + size);
    if (method === 0) out.push({ name, text: data.toString('utf8') });
    else if (method === 8) out.push({ name, text: zlib.inflateRawSync(data).toString('utf8') });
    else throw new Error(`unsupported zip compression method ${method} (${name})`);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * The zip a Playwright HTML report embeds, or null for any other page.
 * @param {string} html
 */
export function embeddedZip(html) {
  const m = html.match(/data:application\/zip;base64,([A-Za-z0-9+/=]+)/);
  return m?.[1] ? Buffer.from(m[1], 'base64') : null;
}

/**
 * The page to link to: index.html if there is one, else the shallowest HTML
 * page, else the shallowest Markdown file (the accessibility audit).
 * @param {string[]} files paths relative to the report folder, with / separators
 * @returns {string | null}
 */
export function findEntry(files) {
  const depth = (f) => f.split('/').length;
  const pick = (/** @type {string[]} */ list) => [...list].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0] ?? null;
  return pick(files.filter((f) => path.posix.basename(f) === 'index.html'))
    ?? pick(files.filter((f) => /\.html?$/i.test(f)))
    ?? pick(files.filter((f) => /\.md$/i.test(f)));
}

/** @param {string} dir @returns {string[]} */
function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

/**
 * @typedef {{ name: string, conclusion: string | null, attempt?: number }} JobResult
 * @typedef {{ name: string, entry: string | null, result: string, redactions: number, withheld: string | null }} ReportRow
 */

/**
 * The CI result behind a report: report-<package> comes from the <package> job;
 * report-regression from the regression shards and their merge job.
 * @param {string} name
 * @param {JobResult[]} jobs
 */
export function resultFor(name, jobs) {
  // Only each job's last attempt counts, as on the dashboard.
  const latest = new Map();
  for (const j of jobs) if (!latest.has(j.name) || (j.attempt ?? 1) > (latest.get(j.name).attempt ?? 1)) latest.set(j.name, j);
  const own = [...latest.values()].filter((j) => (name === 'regression' ? /^regression( |$)/.test(j.name) && j.name !== 'regression scope' : j.name === name));
  if (own.length === 0) return 'unknown';
  if (own.some((j) => j.conclusion === 'failure')) return 'failure';
  return own.every((j) => j.conclusion === 'success') ? 'success' : (own.find((j) => j.conclusion !== 'success')?.conclusion ?? 'unknown');
}

/**
 * Copies every report-<name> folder from rawDir into outDir/<name>, checked as
 * described at the top of this file. Returns one row per report, sorted by name.
 * @param {{ rawDir: string, outDir: string, jobs?: JobResult[] }} options
 * @returns {ReportRow[]}
 */
export function buildReports({ rawDir, outDir, jobs = [] }) {
  if (!fs.existsSync(rawDir)) return [];
  const rows = [];
  for (const folder of fs.readdirSync(rawDir, { withFileTypes: true })) {
    if (!folder.isDirectory() || !folder.name.startsWith('report-')) continue;
    const name = folder.name.slice('report-'.length);
    const src = path.join(rawDir, folder.name);
    const files = listFiles(src);
    const row = { name, entry: findEntry(files), result: resultFor(name, jobs), redactions: 0, withheld: /** @type {string | null} */ (null) };

    // First pass: anything we can't redact (zipped data) must be clean.
    for (const file of files) {
      const buf = fs.readFileSync(path.join(src, file));
      const zip = file.endsWith('.zip') ? buf : /\.html?$/i.test(file) ? embeddedZip(buf.toString('utf8')) : null;
      if (!zip) continue;
      let found;
      try {
        found = unzipTexts(zip).flatMap((entry) => findSecrets(entry.text));
      } catch (err) {
        found = [`unreadable archive (${/** @type {Error} */ (err).message})`];
      }
      if (found.length) { row.withheld = `${file} contains ${[...new Set(found)].join(', ')}`; break; }
    }

    // Second pass: copy, redacting text files.
    if (!row.withheld) {
      for (const file of files) {
        const from = path.join(src, file);
        const to = path.join(outDir, name, ...file.split('/'));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        if (TEXT_EXT.has(path.extname(file).toLowerCase())) {
          const { text, redactions } = redact(fs.readFileSync(from, 'utf8'));
          row.redactions += redactions;
          fs.writeFileSync(to, text);
        } else {
          fs.copyFileSync(from, to);
        }
      }
    }
    rows.push(row);
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** The report from the langfuse-traces job: every AI test in llm-judge-check linked to its trace. */
export const TRACES_SUITE = 'langfuse-traces';

/**
 * Where the traces report was published, relative to the reports page; null if it wasn't.
 * @param {ReportRow[]} rows
 */
export function tracesEntry(rows) {
  const r = rows.find((x) => x.name === TRACES_SUITE);
  return r?.entry && !r.withheld ? `${TRACES_SUITE}/${r.entry}` : null;
}

const RESULT = /** @type {Record<string, { cls: string, icon: string, label: string }>} */ ({
  success: { cls: 'good', icon: '✓', label: 'Passed' },
  failure: { cls: 'critical', icon: '✕', label: 'Failed' },
});

/**
 * @param {ReportRow[]} rows
 * @param {{ repo: string, run: { id: number, number: number, event: string, createdAt: string, conclusion: string | null } | null, generatedAt: string, traceabilityHref?: string | null }} meta
 */
export function renderReportsPage(rows, { repo, run, generatedAt, traceabilityHref = null }) {
  const runText = run
    ? `CI run <a href="https://github.com/${esc(repo)}/actions/runs/${run.id}">#${run.number}</a> (${esc(run.event)}, ${esc(day(run.createdAt))}, ${esc(run.conclusion ?? 'unknown')})`
    : 'the latest CI run';
  const note = (/** @type {ReportRow} */ r) => {
    if (r.withheld) return `Not published: ${esc(r.withheld)}`;
    if (!r.entry) return 'No page to show';
    return r.redactions ? `${r.redactions} token${r.redactions === 1 ? '' : 's'} redacted` : '';
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test Reports</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="viz-root">
<div class="wrap">
  <h1>Test Reports</h1>
  <p class="lede">The HTML reports from ${runText} on main, one per suite. <a href="../">Back to the CI dashboard</a>. Generated ${esc(day(generatedAt))}.</p>
  ${traceabilityHref ? `<p class="lede">Requirement by requirement: the <a href="${esc(traceabilityHref)}">traceability matrix</a> shows each qa-practice-api requirement, the test cases that check it, and their results in this run.</p>` : ''}
  ${tracesEntry(rows) ? `<p class="lede">AI test by AI test: the <a href="${esc(encodeURI(tracesEntry(rows) ?? ''))}">LLM judge traces</a> link each of llm-judge-check's AI tests to its trace in a self-hosted Langfuse, as Langfuse stored it.</p>` : ''}
  <section class="card wide">
    <h2>Reports</h2>
    <p class="sub">Updated after every CI run on main. Tokens are redacted before publishing; a report whose zipped data contains one is withheld.</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Suite</th><th>CI result</th><th>Report</th><th>Notes</th></tr></thead>
      <tbody>
      ${rows.length === 0 ? '<tr><td colspan="4">No reports were uploaded by this run.</td></tr>' : rows.map((r) => {
        const s = RESULT[r.result] ?? { cls: 'warning', icon: '!', label: r.result };
        const link = r.entry && !r.withheld ? `<a href="${esc(encodeURI(`${r.name}/${r.entry}`))}">Open</a>` : '—';
        return `<tr><td>${esc(r.name)}</td><td><span class="status ${s.cls}"><span class="icon" aria-hidden="true">${s.icon}</span>${esc(s.label)}</span></td><td>${link}</td><td>${note(r)}</td></tr>`;
      }).join('')}
      </tbody>
    </table>
    </div>
  </section>
  <footer>Published by packages/ci-dashboard (src/reports.js).</footer>
</div>
</div>
</body>
</html>
`;
}
