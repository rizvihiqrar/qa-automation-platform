// Renders the metrics as one self-contained HTML page: inline SVG charts, no
// external scripts or fonts, light and dark themes, tooltips and a table view.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtSec = (s) => (s === null ? '—' : s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);
const fmtPct = (p) => (p === null ? '—' : `${p}%`);
const day = (iso) => (iso ? iso.slice(0, 10) : '—');

// Round an axis maximum up to a clean number.
export function niceMax(v) {
  if (!v || v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((m) => m >= v);
}

function lineChart({ id, title, subtitle, points, yMax, format }) {
  // A viewBox close to the card's real width keeps SVG text near 12px on desktop.
  const W = 500, H = 220, L = 44, R = 60, T = 16, B = 28;
  const n = points.length;
  const x = (i) => (n <= 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - v / yMax);
  const ticks = [0, yMax / 2, yMax];
  const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.y !== null);
  const path = valid.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const last = valid.at(-1);
  return `
  <figure class="card" id="${id}">
    <figcaption><h2>${esc(title)}</h2><p class="sub">${esc(subtitle)}</p></figcaption>
    <div class="plot" data-chart="${id}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
        ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${esc(format(t))}</text>`).join('')}
        <line class="axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
        ${path ? `<path class="series" d="${path}"/>` : ''}
        ${last ? `<circle class="dot" cx="${x(last.i)}" cy="${y(last.y)}" r="4"/><text class="end-label" x="${x(last.i) + 10}" y="${y(last.y) + 4}">${esc(format(last.y))}</text>` : ''}
        <line class="crosshair" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
        <text class="tick" x="${L}" y="${H - 8}">${esc(points[0]?.label ?? '')}</text>
        <text class="tick" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(points.at(-1)?.label ?? '')}</text>
        <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" tabindex="0" aria-label="${esc(title)}: use arrow keys to read values"/>
      </svg>
    </div>
  </figure>`;
}

// Horizontal bars as HTML rather than SVG, so labels stay at the page's text size
// at any width (a scaled SVG made them huge on desktop and tiny on phones).
function barChart({ title, subtitle, rows }) {
  const max = niceMax(Math.max(...rows.map((r) => r.value ?? 0), 1));
  return `
  <figure class="card wide">
    <figcaption><h2>${esc(title)}</h2><p class="sub">${esc(subtitle)}</p></figcaption>
    <div class="plot bars" role="list" aria-label="${esc(title)}">
      ${rows.map((r) => `<div class="bar-row" role="listitem" tabindex="0" data-name="${esc(r.name)}" data-value="${esc(fmtSec(r.value))}" data-p90="${esc(fmtSec(r.p90))}">
        <span class="cat">${esc(r.name)}</span>
        <span class="track"><span class="bar" style="width:${(((r.value ?? 0) / max) * 100).toFixed(1)}%"></span><span class="value">${esc(fmtSec(r.value))}</span></span>
      </div>`).join('')}
    </div>
  </figure>`;
}

function statusOf(p) {
  if (p.passRate !== null && p.passRate < 100) return { cls: 'critical', icon: '✕', label: 'Has failures' };
  if (p.flaky > 0) return { cls: 'warning', icon: '!', label: `Flaky (${p.flaky})` };
  return { cls: 'good', icon: '✓', label: 'Stable' };
}

export function renderHtml(metrics, { repo, generatedAt }) {
  const { overall, packages, trend } = metrics;
  const tiles = [
    ['CI runs analysed', String(overall.runs)],
    ['Runs fully green', fmtPct(overall.runPassRate)],
    ['Median run time', overall.medianRunMinutes === null ? '—' : `${overall.medianRunMinutes} min`],
    ['Flaky job results', String(overall.flakyJobs)],
  ];
  const passPts = trend.map((t) => ({ y: t.jobPassPct, label: `#${t.number}`, date: day(t.createdAt) }));
  const minPts = trend.map((t) => ({ y: t.minutes, label: `#${t.number}`, date: day(t.createdAt) }));
  const byDuration = [...packages].sort((a, b) => (b.medianSeconds ?? 0) - (a.medianSeconds ?? 0))
    .map((p) => ({ name: p.name, value: p.medianSeconds, p90: p.p90Seconds }));
  // Data for the tooltip script; "<" is escaped so the JSON can't close the script tag.
  const chartData = JSON.stringify({
    pass: { points: passPts, unit: '% of jobs passed' },
    minutes: { points: minPts, unit: 'min' },
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CI Dashboard</title>
<style>
.viz-root {
  color-scheme: light;
  --page: #f9f9f7; --surface-1: #fcfcfb; --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --series-1: #2a78d6; --meter-track: #cde2fb; --ring: rgba(11,11,11,0.10);
  --good: #0ca30c; --warning: #fab219; --critical: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root {
    color-scheme: dark;
    --page: #0d0d0d; --surface-1: #1a1a19; --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --series-1: #3987e5; --meter-track: #184f95; --ring: rgba(255,255,255,0.10);
  }
}
:root[data-theme="dark"] .viz-root {
  color-scheme: dark;
  --page: #0d0d0d; --surface-1: #1a1a19; --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --series-1: #3987e5; --meter-track: #184f95; --ring: rgba(255,255,255,0.10);
}
* { box-sizing: border-box; }
body { margin: 0; }
.viz-root { background: var(--page); color: var(--text-primary); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; min-height: 100vh; padding: 24px 16px 48px; }
.wrap { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 4px; }
.lede { color: var(--text-secondary); margin: 0 0 24px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
.tile, .card { background: var(--surface-1); border-radius: 12px; box-shadow: 0 0 0 1px var(--ring); padding: 16px; }
.tile .label { color: var(--text-secondary); font-size: 14px; }
.tile .value { font-size: 32px; font-weight: 600; margin-top: 4px; }
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 16px; }
.card { margin: 0; min-width: 0; }
.card.wide { margin-bottom: 16px; }
figcaption h2, .card h2 { font-size: 16px; margin: 0; }
.sub { color: var(--text-secondary); font-size: 13px; margin: 2px 0 8px; }
.plot { position: relative; }
svg { width: 100%; height: auto; display: block; overflow: visible; }
.grid { stroke: var(--grid); stroke-width: 1; }
.axis { stroke: var(--axis); stroke-width: 1; }
.tick, .cat { fill: var(--text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.cat { fill: var(--text-secondary); }
.series { fill: none; stroke: var(--series-1); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.dot { fill: var(--series-1); stroke: var(--surface-1); stroke-width: 2; }
.end-label, .value { fill: var(--text-primary); font-size: 12px; font-variant-numeric: tabular-nums; }
.crosshair { stroke: var(--text-muted); stroke-width: 1; }
.hit { fill: transparent; cursor: crosshair; }
.hit:focus { outline: none; }
.plot:focus-within { outline: 2px solid var(--series-1); outline-offset: 4px; border-radius: 6px; }
.bars { display: grid; gap: 6px; }
.bar-row { display: grid; grid-template-columns: minmax(110px, 200px) 1fr; align-items: center; gap: 12px; padding: 2px 0; border-radius: 4px; }
.bar-row .cat { color: var(--text-secondary); font-size: 13px; text-align: right; overflow-wrap: anywhere; }
.track { display: flex; align-items: center; gap: 6px; min-width: 0; border-left: 1px solid var(--axis); }
.bar { display: block; height: 18px; min-width: 2px; background: var(--series-1); border-radius: 0 4px 4px 0; }
.bar-row .value { color: var(--text-primary); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bar-row:hover .bar, .bar-row:focus .bar { opacity: 0.8; }
.bar-row:focus { outline: 2px solid var(--series-1); outline-offset: 2px; }
.bar-row:focus .cat, .bar-row:hover .cat { color: var(--text-primary); }
.tooltip { position: absolute; pointer-events: none; background: var(--surface-1); color: var(--text-primary); box-shadow: 0 0 0 1px var(--ring), 0 4px 12px rgba(0,0,0,0.12); border-radius: 8px; padding: 6px 10px; font-size: 13px; white-space: nowrap; transform: translate(-50%, calc(-100% - 10px)); z-index: 2; }
.tooltip strong { display: block; font-size: 15px; font-variant-numeric: tabular-nums; }
.tooltip .muted { color: var(--text-secondary); }
.tooltip .key { display: inline-block; width: 12px; height: 2px; background: var(--series-1); vertical-align: middle; margin-right: 6px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--grid); }
th { color: var(--text-secondary); font-weight: 600; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.meter { display: inline-block; width: 64px; height: 6px; border-radius: 3px; background: var(--meter-track); vertical-align: middle; margin-right: 8px; overflow: hidden; }
.meter span { display: block; height: 100%; background: var(--series-1); }
.status { white-space: nowrap; }
.status .icon { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 700; margin-right: 6px; }
.status.good .icon { background: var(--good); } .status.warning .icon { background: var(--warning); color: #0b0b0b; } .status.critical .icon { background: var(--critical); }
details { margin-top: 8px; } summary { cursor: pointer; color: var(--text-secondary); font-size: 13px; }
footer { color: var(--text-muted); font-size: 13px; margin-top: 24px; }
</style>
</head>
<body>
<div class="viz-root">
<div class="wrap">
  <h1>CI Dashboard</h1>
  <p class="lede">Results of the last ${overall.runs} CI runs of <strong>${esc(repo)}</strong>, across ${overall.packages} packages. Generated ${esc(day(generatedAt))}.</p>

  <section class="tiles" aria-label="Summary">
    ${tiles.map(([l, v]) => `<div class="tile"><div class="label">${esc(l)}</div><div class="value">${esc(v)}</div></div>`).join('')}
  </section>

  <section class="charts">
    ${lineChart({ id: 'pass', title: 'Jobs passed per run', subtitle: 'Share of package jobs that passed, oldest run on the left', points: passPts, yMax: 100, format: (v) => `${Math.round(v)}%` })}
    ${lineChart({ id: 'minutes', title: 'Run duration', subtitle: 'Wall-clock minutes per CI run', points: minPts, yMax: niceMax(Math.max(...minPts.map((p) => p.y ?? 0), 1)), format: (v) => `${Math.round(v * 10) / 10} min` })}
  </section>

  ${barChart({ title: 'Median job time by package', subtitle: 'Slowest first; hover or focus a bar for the 90th percentile', rows: byDuration })}

  <section class="card wide">
    <h2>Packages</h2>
    <p class="sub">Pass rate over the analysed runs. Flaky counts jobs that failed then passed on a re-run, or failed and passed on the same commit.</p>
    <div class="table-wrap">
    <table>
      <thead><tr><th>Package</th><th>Pass rate</th><th class="num">Results</th><th class="num">Median</th><th class="num">p90</th><th>Status</th><th>Last failure</th></tr></thead>
      <tbody>
      ${packages.map((p) => {
        const s = statusOf(p);
        return `<tr><td>${esc(p.name)}</td><td><span class="meter" aria-hidden="true"><span style="width:${p.passRate ?? 0}%"></span></span>${esc(fmtPct(p.passRate))}</td><td class="num">${p.results}</td><td class="num">${esc(fmtSec(p.medianSeconds))}</td><td class="num">${esc(fmtSec(p.p90Seconds))}</td><td><span class="status ${s.cls}"><span class="icon" aria-hidden="true">${s.icon}</span>${esc(s.label)}</span></td><td>${esc(day(p.lastFailure))}</td></tr>`;
      }).join('')}
      </tbody>
    </table>
    </div>
    <details>
      <summary>Show run-by-run data</summary>
      <div class="table-wrap"><table>
        <thead><tr><th>Run</th><th>Date</th><th>Trigger</th><th>Result</th><th class="num">Jobs passed</th><th class="num">Minutes</th></tr></thead>
        <tbody>${trend.map((t) => `<tr><td>#${t.number}</td><td>${esc(day(t.createdAt))}</td><td>${esc(t.event)}</td><td>${esc(t.conclusion)}</td><td class="num">${esc(fmtPct(t.jobPassPct))}</td><td class="num">${t.minutes ?? '—'}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>
  </section>

  <footer>Built from the GitHub Actions API by packages/ci-dashboard.</footer>
</div>
</div>
<script>
(() => {
  const data = ${chartData};
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;

  function show(plot, left, top, value, caption) {
    tip.replaceChildren();
    const strong = document.createElement('strong');
    const key = document.createElement('span');
    key.className = 'key';
    strong.append(key, document.createTextNode(value));
    const cap = document.createElement('span');
    cap.className = 'muted';
    cap.textContent = caption;
    tip.append(strong, cap);
    plot.append(tip);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.hidden = false;
  }
  const hide = () => { tip.hidden = true; };

  document.querySelectorAll('.plot[data-chart]').forEach((plot) => {
    const { points, unit } = data[plot.dataset.chart];
    const svg = plot.querySelector('svg');
    const hit = svg.querySelector('.hit');
    const cross = svg.querySelector('.crosshair');
    const vb = svg.viewBox.baseVal;
    const x0 = hit.x.baseVal.value, w = hit.width.baseVal.value;
    let current = points.length - 1;

    function at(i) {
      current = Math.max(0, Math.min(points.length - 1, i));
      const p = points[current];
      const xv = points.length <= 1 ? x0 + w / 2 : x0 + (current * w) / (points.length - 1);
      cross.setAttribute('x1', xv); cross.setAttribute('x2', xv); cross.setAttribute('visibility', 'visible');
      const scale = svg.clientWidth / vb.width;
      const value = p.y === null ? 'no data' : (Math.round(p.y * 10) / 10) + (unit === 'min' ? ' min' : '%');
      show(plot, xv * scale, hit.y.baseVal.value * scale, value, 'Run ' + p.label + ' · ' + p.date);
    }
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const xv = ((e.clientX - r.left) / r.width) * vb.width;
      at(points.length <= 1 ? 0 : Math.round(((xv - x0) / w) * (points.length - 1)));
    });
    hit.addEventListener('pointerleave', () => { hide(); cross.setAttribute('visibility', 'hidden'); });
    hit.addEventListener('focus', () => at(current));
    hit.addEventListener('blur', () => { hide(); cross.setAttribute('visibility', 'hidden'); });
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { at(current - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { at(current + 1); e.preventDefault(); }
    });
  });

  document.querySelectorAll('.bar-row').forEach((row) => {
    const plot = row.closest('.plot');
    const place = () => {
      const bar = row.querySelector('.bar').getBoundingClientRect();
      const box = plot.getBoundingClientRect();
      show(plot, bar.right - box.left, bar.top - box.top, row.dataset.value + ' median', row.dataset.name + ' · p90 ' + row.dataset.p90);
    };
    row.addEventListener('pointerenter', place);
    row.addEventListener('focus', place);
    row.addEventListener('pointerleave', hide);
    row.addEventListener('blur', hide);
  });
})();
</script>
</body>
</html>
`;
}
