// Turns raw timing runs into a per-worker-count summary.

export interface Run {
  workers: number;
  seconds: number;
  passed: number;
  failed: number;
  flaky?: number;
}

export interface SummaryRow {
  workers: number;
  runs: number;
  medianSeconds: number;
  speedup: number;
  efficiency: number;
  passed: number;
  flaky: number;
  failed: number;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error('median of an empty list');
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// Speedup is measured against the lowest worker count. Efficiency is speedup divided by workers,
// so 1.0 means perfect scaling and low values mean the extra workers are mostly waiting on something.
export function summarize(runs: readonly Run[]): SummaryRow[] {
  const groups = new Map<number, Run[]>();
  for (const run of runs) {
    const list = groups.get(run.workers) ?? [];
    list.push(run);
    groups.set(run.workers, list);
  }
  const grouped = [...groups.entries()].sort(([a], [b]) => a - b);
  const first = grouped[0];
  if (!first) return [];
  const [baseWorkers, baseRuns] = first;
  const baseline = median(baseRuns.map((r) => r.seconds));

  return grouped.map(([workers, rs]) => {
    const medianSeconds = median(rs.map((r) => r.seconds));
    const speedup = baseline / medianSeconds;
    const last = rs[rs.length - 1]!;
    return {
      workers,
      runs: rs.length,
      medianSeconds,
      speedup,
      efficiency: speedup / (workers / baseWorkers),
      passed: last.passed,
      flaky: last.flaky ?? 0,
      failed: last.failed,
    };
  });
}

export function toMarkdown(rows: readonly SummaryRow[]): string {
  const header = '| Workers | Median time (s) | Speedup | Efficiency | Passed | Flaky | Failed |';
  const divider = '|---:|---:|---:|---:|---:|---:|---:|';
  const lines = rows.map((r) =>
    `| ${r.workers} | ${r.medianSeconds.toFixed(1)} | ${r.speedup.toFixed(2)}x | ${(r.efficiency * 100).toFixed(0)}% | ${r.passed} | ${r.flaky} | ${r.failed} |`
  );
  return [header, divider, ...lines].join('\n');
}
