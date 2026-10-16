// Turns k6 summary JSON (written by handleSummary) into a short report.

const round = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : null);

// Per-endpoint duration metrics look like `http_req_duration{name:login}`.
const ENDPOINT = /^http_req_duration\{name:(.+)\}$/;

export function readSummary(name, data) {
  const m = data.metrics ?? {};
  const thresholds = [];
  for (const [metric, value] of Object.entries(m)) {
    for (const [rule, result] of Object.entries(value.thresholds ?? {})) {
      thresholds.push({ metric, rule, ok: result.ok });
    }
  }
  const endpoints = Object.entries(m)
    .filter(([metric]) => ENDPOINT.test(metric))
    .map(([metric, value]) => ({
      name: metric.match(ENDPOINT)[1],
      p95: round(value.values['p(95)']),
      avg: round(value.values.avg),
      max: round(value.values.max),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    name,
    requests: m.http_reqs?.values?.count ?? 0,
    rps: round(m.http_reqs?.values?.rate),
    errorRate: round((m.http_req_failed?.values?.rate ?? 0) * 100),
    checksRate: round((m.checks?.values?.rate ?? 0) * 100),
    p95: round(m.http_req_duration?.values?.['p(95)']),
    maxVus: m.vus_max?.values?.max ?? null,
    endpoints,
    thresholds,
    passed: thresholds.every((t) => t.ok),
  };
}

export function toMarkdown(summaries) {
  const lines = [
    '| Test | Requests | Req/s | Errors | Checks | p95 (ms) | Max VUs | Thresholds |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...summaries.map((s) => `| ${s.name} | ${s.requests} | ${s.rps} | ${s.errorRate}% | ${s.checksRate}% | ${s.p95} | ${s.maxVus ?? '—'} | ${s.passed ? 'pass' : 'FAIL'} |`),
  ];
  for (const s of summaries) {
    lines.push('', `**${s.name}**: p95 per endpoint`, '', '| Endpoint | p95 | avg | max |', '|---|---:|---:|---:|');
    for (const e of s.endpoints) lines.push(`| ${e.name} | ${e.p95} | ${e.avg} | ${e.max} |`);
    const failed = s.thresholds.filter((t) => !t.ok);
    if (failed.length) lines.push('', 'Failed thresholds: ' + failed.map((t) => `\`${t.metric}: ${t.rule}\``).join(', '));
  }
  return lines.join('\n') + '\n';
}
