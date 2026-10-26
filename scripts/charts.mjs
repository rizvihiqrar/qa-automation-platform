// Draws the two charts of Day 59, each in a light and a dark version, in the dashboard's colours
// (packages/ci-dashboard/src/render.js):
//   docs/assets/login-before-after-{light,dark}.svg   what one password hash did to the API, and the fix
//   docs/assets/scoreboard-heatmap-{light,dark}.svg   7 mistakes against 9 kinds of check
// The heatmap is read from the table in docs/ai-written-code/scoreboard.md, so it cannot drift from it.
//   node scripts/charts.mjs          # rewrite the files
// scripts/charts.test.mjs fails if the committed files differ from what this prints.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The dashboard's tokens, plus the three steps of its blue that carry the heatmap counts.
export const THEMES = {
  light: {
    page: '#f9f9f7', surface: '#fcfcfb', text: '#0b0b0b', text2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7',
    series: '#2a78d6', before: '#898781', steps: ['#cde2fb', '#86b7ef', '#2a78d6'], stepText: ['#0b0b0b', '#0b0b0b', '#ffffff'],
  },
  dark: {
    page: '#0d0d0d', surface: '#1a1a19', text: '#f0efec', text2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835',
    series: '#3987e5', before: '#898781', steps: ['#184f95', '#2a6fc0', '#3987e5'], stepText: ['#f0efec', '#ffffff', '#0d0d0d'],
  },
};

const FONT = 'font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x, y, s, { size = 14, fill, weight = 400, anchor = 'start' }) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" ${FONT}>${esc(s)}</text>`;

// ---- Chart 1: what one password hash did to the API ---------------------------------------------
// Figures from docs/rca/01-login-hashing-blocked-the-api.md. The 70 ms is how long ONE hash held the
// main thread (about 70 ms at cost 10); 67 ms and 1 ms are the p95 of `list products`, which is not the login time.
export const LOGIN = { hashMs: 70, listBeforeP95: 67, listAfterP95: 1 };

export function loginChart(theme) {
  const t = THEMES[theme];
  const W = 760, H = 400;
  const x0 = 40, track = 680; // the 0 to 80 ms strip is 680 px wide
  const px = (ms) => x0 + (ms / 80) * track;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">`);
  out.push(`<title id="t">One password hash blocked the API for about 70 ms; list products p95 went from 67 ms to 1 ms after the fix</title>`);
  out.push(`<desc id="d">Top: a 70 ms block on the main thread while one login hashes, with requests that arrive during it waiting. Bottom: bars of the list products p95, 67 ms before the fix and 1 ms after.</desc>`);
  out.push(`<rect width="${W}" height="${H}" rx="12" fill="${t.surface}"/>`);

  // Top: the main thread over time
  out.push(text(x0, 38, 'One login blocked the whole API', { size: 18, weight: 600, fill: t.text }));
  out.push(text(x0, 60, 'Node runs JavaScript on one thread. bcryptjs hashed on it, and nothing else could start meanwhile.', { size: 13, fill: t.text2 }));
  const y = 96;
  out.push(`<rect x="${x0}" y="${y}" width="${track}" height="34" rx="4" fill="${t.grid}"/>`);
  out.push(`<rect x="${x0}" y="${y}" width="${px(LOGIN.hashMs) - x0}" height="34" rx="4" fill="${t.series}"/>`);
  out.push(text(x0 + 12, y + 22, `one password hash, about ${LOGIN.hashMs} ms`, { size: 14, weight: 600, fill: t.stepText[2] }));
  // requests that arrive during the hash wait until it ends
  for (const ms of [8, 22, 38, 54]) {
    out.push(`<line x1="${px(ms)}" y1="${y + 40}" x2="${px(ms)}" y2="${y + 58}" stroke="${t.text2}" stroke-width="2"/>`);
    out.push(`<path d="M${px(ms)} ${y + 62} L${px(LOGIN.hashMs) - 4} ${y + 62}" stroke="${t.axis}" stroke-width="2" stroke-dasharray="3 3" fill="none"/>`);
  }
  out.push(text(x0, y + 86, 'Every request that arrives during the hash (the ticks) waits until it ends', { size: 12, fill: t.text2 }));
  for (const ms of [0, 20, 40, 60, 80]) out.push(text(px(ms), y + 112, `${ms} ms`, { size: 12, fill: t.muted, anchor: ms === 0 ? 'start' : ms === 80 ? 'end' : 'middle' }));

  // Bottom: list products p95, before and after
  const by = 256, bx = 150, bw = 520;
  const bar = (v) => Math.max(2, (v / LOGIN.listBeforeP95) * bw);
  out.push(text(x0, by - 22, 'list products, p95 (20 users, one in four iterations logs in)', { size: 14, weight: 600, fill: t.text }));
  for (const [i, [label, v, fill]] of [['before the fix', LOGIN.listBeforeP95, t.before], ['after the fix', LOGIN.listAfterP95, t.series]].entries()) {
    const yy = by + i * 52;
    out.push(text(x0, yy + 24, label, { size: 14, fill: t.text2 }));
    out.push(`<rect x="${bx}" y="${yy + 4}" width="${bar(v)}" height="28" rx="4" fill="${fill}"/>`);
    out.push(text(bx + bar(v) + 10, yy + 24, `${v} ms`, { size: 15, weight: 600, fill: t.text }));
  }
  out.push(text(x0, H - 14, 'Fix: hash with crypto.scrypt, which runs off the main thread. Source: docs/rca/01-login-hashing-blocked-the-api.md', { size: 11, fill: t.muted }));
  out.push('</svg>');
  return out.join('\n');
}

// ---- Chart 2: the scoreboard heatmap ---------------------------------------------------------------
export function readScoreboard() {
  const md = fs.readFileSync(path.join(ROOT, 'docs/ai-written-code/scoreboard.md'), 'utf8');
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('| Mistake |'));
  const header = lines[start].split('|').slice(1, -1).map((c) => c.trim());
  const rows = [];
  for (let i = start + 2; lines[i]?.startsWith('|'); i++) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
  return { columns: header.slice(2), rows: rows.map(([id, kind, ...cells]) => ({ id, kind, cells })) };
}

export function heatmapChart(theme) {
  const t = THEMES[theme];
  const { columns, rows } = readScoreboard();
  const cell = 64, gap = 2, left = 120, top = 118;
  const W = left + columns.length * (cell + gap) + 24, H = top + rows.length * (cell - 14 + gap) + 74;
  const rh = cell - 14;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">`);
  out.push(`<title id="t">Scoreboard: ${rows.length} mistakes in the AI's code against ${columns.length} kinds of check</title>`);
  out.push(`<desc id="d">A grid with one row per mistake and one column per kind of check. A number is how many tests of that kind failed when the mistake was put back; a dash means none did; a tick means the code review found it by reading.</desc>`);
  out.push(`<rect width="${W}" height="${H}" rx="12" fill="${t.surface}"/>`);
  out.push(text(24, 36, 'What caught each mistake the AI made', { size: 18, weight: 600, fill: t.text }));
  out.push(text(24, 58, 'Number: tests of that kind that failed with the mistake put back. Dash: none did. Tick: found by reading the code.', { size: 12, fill: t.text2 }));
  columns.forEach((name, c) => {
    const cx = left + c * (cell + gap) + cell / 2;
    const label = name.replace(/\s*\(.*\)/, '');
    // two lines for a long name; "Property-based" breaks after its hyphen
    const lines2 = label.includes('-') ? [`${label.split('-')[0]}-`, label.split('-')[1]]
      : label.length > 11 ? [label.split(' ')[0], label.split(' ').slice(1).join(' ')] : [label];
    lines2.forEach((ln, i) => out.push(text(cx, top - 26 + i * 15, ln, { size: 12, fill: t.text2, anchor: 'middle' })));
  });
  rows.forEach((row, r) => {
    const y = top + r * (rh + gap);
    out.push(text(24, y + rh / 2 + 5, row.id, { size: 14, weight: 600, fill: t.text }));
    out.push(text(76, y + rh / 2 + 5, row.kind === 'spec gap' ? 'gap' : 'defect', { size: 11, fill: t.muted }));
    row.cells.forEach((v, c) => {
      const x = left + c * (cell + gap);
      const n = Number(v);
      if (Number.isInteger(n) && n > 0) {
        const step = Math.min(n, 3) - 1;
        out.push(`<rect x="${x}" y="${y}" width="${cell}" height="${rh}" rx="4" fill="${t.steps[step]}"/>`);
        out.push(text(x + cell / 2, y + rh / 2 + 6, n, { size: 17, weight: 600, fill: t.stepText[step], anchor: 'middle' }));
      } else {
        out.push(`<rect x="${x}" y="${y}" width="${cell}" height="${rh}" rx="4" fill="${t.grid}" fill-opacity="0.5"/>`);
        out.push(text(x + cell / 2, y + rh / 2 + 5, v === '✔' ? '✔' : '–', { size: 16, weight: v === '✔' ? 700 : 400, fill: v === '✔' ? t.text : t.muted, anchor: 'middle' }));
      }
    });
  });
  const ly = top + rows.length * (rh + gap) + 24;
  out.push(text(24, ly + 12, 'Tests that failed:', { size: 12, fill: t.text2 }));
  [1, 2, 3].forEach((n, i) => {
    const x = 150 + i * 70;
    out.push(`<rect x="${x}" y="${ly}" width="28" height="18" rx="3" fill="${t.steps[i]}"/>`);
    out.push(text(x + 14, ly + 14, n === 3 ? '3+' : n, { size: 12, weight: 600, fill: t.stepText[i], anchor: 'middle' }));
  });
  out.push('</svg>');
  return out.join('\n');
}

export function renderAll() {
  const files = {};
  for (const theme of ['light', 'dark']) {
    files[`docs/assets/login-before-after-${theme}.svg`] = `${loginChart(theme)}\n`;
    files[`docs/assets/scoreboard-heatmap-${theme}.svg`] = `${heatmapChart(theme)}\n`;
  }
  return files;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [file, svg] of Object.entries(renderAll())) {
    fs.writeFileSync(path.join(ROOT, file), svg);
    console.log(`wrote ${file}`);
  }
}
