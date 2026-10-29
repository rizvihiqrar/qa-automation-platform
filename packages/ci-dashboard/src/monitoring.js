// The "Uptime of public demo sites" section: what packages/synthetic-monitor last wrote to the
// monitoring-data branch (summary.json), shown as a table with a sparkline of load times.
import fs from 'node:fs';
import path from 'node:path';
import { esc } from './render.js';

// The monitor runs every 30 minutes; three missed runs (90 minutes) mean it has stopped. The page
// is rebuilt every 3 hours and this is checked when it is built, so the limit is shorter than that.
export const STALE_AFTER_MS = 90 * 60_000;

const STATUS = {
  up: { cls: 'good', icon: '✓', label: 'Up' },
  degraded: { cls: 'warning', icon: '!', label: 'One failed run' },
  down: { cls: 'critical', icon: '✕', label: 'Down' },
};

const pct = (v) => (typeof v === 'number' ? `${v}%` : '—');
const ms = (v) => (v === null || v === undefined ? '—' : v >= 10_000 ? `${Math.round(v / 1000)} s` : `${v} ms`);

/** Load times as a line (broken where the site was down) with a red mark at each failed run. */
export function sparkline(series, { width = 160, height = 28 } = {}) {
  const values = series.filter((v) => v !== null);
  if (!values.length) return '';
  const max = Math.max(...values, 1);
  const step = series.length > 1 ? width / (series.length - 1) : 0;
  const x = (i) => Math.round(i * step * 10) / 10;
  const y = (v) => Math.round((height - 6 - (v / max) * (height - 12)) * 10) / 10;
  const paths = [];
  const dots = [];
  let run = [];
  const flush = () => {
    if (run.length === 1) dots.push(run[0]);
    else if (run.length > 1) paths.push(`M${run.map(([px, py]) => `${px} ${py}`).join(' L')}`);
    run = [];
  };
  const misses = [];
  series.forEach((v, i) => {
    if (v === null) { flush(); misses.push(x(i)); } else run.push([x(i), y(v)]);
  });
  flush();
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" aria-hidden="true">${
    paths.map((d) => `<path d="${d}"/>`).join('')}${
    dots.map(([px, py]) => `<circle cx="${px}" cy="${py}" r="1.5"/>`).join('')}${
    misses.map((px) => `<rect class="miss" x="${px - 1}" y="${height - 4}" width="2" height="4"/>`).join('')}</svg>`;
}

/**
 * @param {{ generatedAt?: string, sites: Array<any> } | null} summary what the monitor wrote
 * @param {string} now when the dashboard is being built (ISO)
 */
export function renderMonitoring(summary, now) {
  if (!summary?.sites?.length) return '';
  const age = Date.parse(now) - Date.parse(summary.generatedAt);
  // A missing or unreadable time is the case where the data is least trustworthy: counted as stale.
  const stale = !Number.isFinite(age) || age > STALE_AFTER_MS;
  const rows = summary.sites.map((s) => {
    // A status this page does not know is shown as it is, in the warning colour, not as an outage.
    const st = STATUS[s.status] ?? { cls: 'warning', icon: '?', label: String(s.status ?? 'unknown') };
    const slow = s.slow ? ' <span class="status warning"><span class="icon" aria-hidden="true">!</span>Slow</span>' : '';
    return `<tr><td>${esc(s.site)}</td><td><span class="status ${st.cls}"><span class="icon" aria-hidden="true">${st.icon}</span>${esc(st.label)}</span>${slow}${s.lastError ? `<div class="sub">${esc(s.lastError)}</div>` : ''}</td><td class="num">${esc(pct(s.uptimePct))}</td><td class="num">${esc(ms(s.medianMs))}</td><td class="num">${esc(ms(s.latestMs))}</td><td>${sparkline(s.series ?? [])}</td></tr>`;
  }).join('');
  return `<section class="card wide" id="monitoring">
    <h2>Uptime of public demo sites</h2>
    <p class="sub">A real browser opens each site every 30 minutes (packages/synthetic-monitor). <strong>Down</strong> means 2 failed runs in a row, each tried twice; <strong>Slow</strong> means the latest load took more than 3 times the site's own median. Uptime and median cover the last 30 days. Last check ${esc(summary.generatedAt ?? 'unknown')}.</p>${stale ? `
    <p class="status critical stale"><span class="icon" aria-hidden="true">✕</span>The monitor has not reported for more than 90 minutes: these numbers may be out of date.</p>` : ''}
    <div class="table-wrap">
    <table>
      <thead><tr><th>Site</th><th>Status</th><th class="num">Uptime</th><th class="num">Median</th><th class="num">Latest</th><th>Load time, last 24 hours</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  </section>`;
}

/**
 * Reads the monitor's summary for build.js. A missing or unreadable file is a warning, never a failed
 * dashboard. The summary is published as <outDir>/monitoring.json only when the section is shown, so the
 * file and the page cannot disagree.
 */
export function loadMonitoring(file, now, outDir, warn = console.warn) {
  if (!file || !fs.existsSync(file)) return '';
  try {
    const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
    const html = renderMonitoring(summary, now);
    if (html) fs.writeFileSync(path.join(outDir, 'monitoring.json'), JSON.stringify(summary, null, 2));
    return html;
  } catch (err) {
    warn(`::warning::Left out the monitoring section: ${err instanceof Error ? err.message : err}`);
    return '';
  }
}
