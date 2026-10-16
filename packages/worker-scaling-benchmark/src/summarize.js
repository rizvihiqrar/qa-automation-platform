// Turns raw timing runs into a per-worker-count summary.

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// runs: [{ workers, seconds, passed, failed }]
// Speedup is measured against the lowest worker count. Efficiency is speedup divided by workers,
// so 1.0 means perfect scaling and low values mean the extra workers are mostly waiting on something.
export function summarize(runs) {
  const groups = new Map();
  for (const run of runs) {
    if (!groups.has(run.workers)) groups.set(run.workers, []);
    groups.get(run.workers).push(run);
  }
  const grouped = [...groups.entries()].sort(([a], [b]) => a - b);
  const baseline = median(grouped[0][1].map((r) => r.seconds));

  return grouped.map(([workers, rs]) => {
    const medianSeconds = median(rs.map((r) => r.seconds));
    const speedup = baseline / medianSeconds;
    const last = rs[rs.length - 1];
    return {
      workers,
      runs: rs.length,
      medianSeconds,
      speedup,
      efficiency: speedup / (workers / grouped[0][0]),
      passed: last.passed,
      flaky: last.flaky ?? 0,
      failed: last.failed,
    };
  });
}

export function toMarkdown(rows) {
  const header = '| Workers | Median time (s) | Speedup | Efficiency | Passed | Flaky | Failed |';
  const divider = '|---:|---:|---:|---:|---:|---:|---:|';
  const lines = rows.map((r) =>
    `| ${r.workers} | ${r.medianSeconds.toFixed(1)} | ${r.speedup.toFixed(2)}x | ${(r.efficiency * 100).toFixed(0)}% | ${r.passed} | ${r.flaky} | ${r.failed} |`
  );
  return [header, divider, ...lines].join('\n');
}
