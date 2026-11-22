// Release drift check: compares one release's results with the releases before it and
// flags a change that is bigger than the normal run-to-run noise.
//
// The limit for each metric is not a number someone picked. It comes from the history:
// the median of past runs plus a few times their typical spread. A metric that has
// never moved gets a small floor instead, so one extra millisecond is not an alert.

export const DEFAULTS = {
  spreads: 6, // how many typical spreads above the median still count as noise
  minRelative: 0.15, // a change under 15% of the median is never drift
  minAbsolute: 1, // and never less than this much room, so a median of 0 does not make every value drift
  minSamples: 10, // fewer past runs than this and there is no honest limit to set (5 gave 3 false alerts in 15 real runs)
};

// How each metric is judged.
//   slower:  higher is worse, judged against the noise limit (times and rates)
//   exact:   any difference from the usual value is a change (how many tests ran)
//   count:   higher is worse, any value above the largest seen before is drift (failures)
export const METRICS = {
  durationMs: { kind: 'slower', label: 'Whole smoke run (ms)' },
  slowestTestMs: { kind: 'slower', label: 'Slowest test (ms)' },
  medianTestMs: { kind: 'slower', label: 'Median test (ms)' },
  tests: { kind: 'exact', label: 'Tests run' },
  failed: { kind: 'count', label: 'Failed tests' },
  flaky: { kind: 'count', label: 'Flaky tests' },
  p95Ms: { kind: 'slower', label: 'k6 p95 response (ms)' },
  avgMs: { kind: 'slower', label: 'k6 average response (ms)' },
  errorRate: { kind: 'count', label: 'k6 failed request rate' },
};

const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function* eachResult(suites) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      // A skipped test never ran, so it has no time to count (and is not in the "tests" total either).
      for (const t of (spec.tests ?? []).filter((x) => x.status !== 'skipped')) yield { status: t.status, duration: (t.results ?? []).reduce((sum, r) => sum + (r.duration ?? 0), 0) };
    }
    yield* eachResult(suite.suites);
  }
}

/** Playwright JSON report to the metrics the check watches. */
export function metricsFromPlaywright(report) {
  const durations = [...eachResult(report.suites)].map((t) => t.duration);
  const s = report.stats ?? {};
  return {
    durationMs: Math.round(s.duration ?? 0),
    slowestTestMs: durations.length ? Math.max(...durations) : 0,
    medianTestMs: durations.length ? median(durations) : 0,
    tests: (s.expected ?? 0) + (s.unexpected ?? 0) + (s.flaky ?? 0),
    failed: s.unexpected ?? 0,
    flaky: s.flaky ?? 0,
  };
}

/** k6 summary JSON (from handleSummary) to its response-time and error metrics. */
export function metricsFromK6(summary) {
  const duration = summary.metrics?.http_req_duration?.values ?? {};
  const failed = summary.metrics?.http_req_failed?.values ?? {};
  const out = {};
  if (duration['p(95)'] !== undefined) out.p95Ms = duration['p(95)'];
  if (duration.avg !== undefined) out.avgMs = duration.avg;
  if (failed.rate !== undefined) out.errorRate = failed.rate;
  return out;
}

/**
 * What normal looks like for each metric in the history.
 * @param {Array<{ metrics: Record<string, number> }>} history
 */
export function baseline(history, options = {}, only = null) {
  const { minSamples } = { ...DEFAULTS, ...options };
  const names = (only ?? [...new Set(history.flatMap((h) => Object.keys(h.metrics)))]).filter((n) => METRICS[n]);
  const out = {};
  for (const name of names) {
    const values = history.map((h) => h.metrics[name]).filter((v) => typeof v === 'number');
    if (values.length < minSamples) throw new Error(`Only ${values.length} past run(s) have "${name}"; at least ${minSamples} are needed to know what normal is`);
    const mid = median(values);
    // Median absolute deviation, scaled so it matches a standard deviation on normal data.
    const spread = 1.4826 * median(values.map((v) => Math.abs(v - mid)));
    out[name] = { median: mid, spread, max: Math.max(...values), samples: values.length };
  }
  return out;
}

/**
 * Compares one run with the history. Returns the alerts (empty means no drift).
 * @param {Array<{ metrics: Record<string, number> }>} history
 * @param {Record<string, number>} run
 */
export function checkDrift(history, run, options = {}) {
  const { spreads, minRelative, minAbsolute, minSamples } = { ...DEFAULTS, ...options };
  // Only the metrics in this run matter. One that too few past runs recorded (k6 numbers, say) is
  // left out; if none of them has enough history there is nothing honest to compare with.
  const wanted = Object.keys(run).filter((n) => METRICS[n]);
  const count = (n) => history.filter((h) => typeof h.metrics[n] === 'number').length;
  const usable = wanted.filter((n) => count(n) >= minSamples);
  if (wanted.length > 0 && usable.length === 0) baseline(history, options, wanted.slice(0, 1));
  const base = baseline(history, options, usable);
  const alerts = [];
  for (const [name, value] of Object.entries(run)) {
    const b = base[name];
    if (!b || !METRICS[name]) continue;
    const { kind, label } = METRICS[name];
    if (kind === 'slower') {
      const room = Math.max(spreads * b.spread, minRelative * b.median, minAbsolute);
      const limit = b.median + room;
      if (value > limit) alerts.push({ metric: name, label, value, usual: b.median, limit, reason: `${round(value)} is above the limit of ${round(limit)} (usual ${round(b.median)})` });
    } else if (kind === 'exact') {
      if (value !== b.median) alerts.push({ metric: name, label, value, usual: b.median, limit: b.median, reason: `${round(value)} tests ran, usually ${round(b.median)}` });
    } else if (value > b.max) {
      alerts.push({ metric: name, label, value, usual: b.median, limit: b.max, reason: `${round(value)} is more than the most seen before (${round(b.max)})` });
    }
  }
  return alerts;
}

const round = (n) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 1000) / 1000);

export function formatDrift(alerts, { label } = /** @type {{ label?: string }} */ ({})) {
  const head = `## Release drift${label ? ` for ${label}` : ''}: ${alerts.length ? '⚠ DRIFT' : '✅ no drift'}`;
  if (!alerts.length) return `${head}\n\nEvery metric is inside the normal run-to-run noise of the past releases.\n`;
  return [head, '', '| Metric | Now | Usual | Limit |', '|---|---:|---:|---:|', ...alerts.map((a) => `| ${a.label} | ${round(a.value)} | ${round(a.usual)} | ${round(a.limit)} |`), '', ...alerts.map((a) => `- ${a.label}: ${a.reason}`), ''].join('\n');
}
