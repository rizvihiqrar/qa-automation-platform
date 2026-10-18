// Turns normalized runs into the numbers the dashboard shows.

const COUNTED = new Set(['success', 'failure']);

export function quantile(values, q) {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)];
}

// The last attempt of each job in a run is its result.
function finalJobs(run) {
  const latest = new Map();
  for (const j of run.jobs) {
    if (!latest.has(j.name) || j.attempt > latest.get(j.name).attempt) latest.set(j.name, j);
  }
  return [...latest.values()];
}

// Pass rates, durations, last failures and the trend count runs on main only (pushes,
// the nightly run, manual runs on main): a failure on a feature branch is usually a
// change still being worked on, not something broken, and counting it made healthy
// packages read "Has failures". Flaky detection uses every run: a job that fails and
// then passes on the same commit is flaky whichever branch it ran on.
export function computeMetrics(runsInput, { branch = 'main' } = {}) {
  const all = [...runsInput].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const runs = all.filter((r) => r.branch === branch);
  const pkgs = new Map();
  const pkg = (name) => {
    if (!pkgs.has(name)) pkgs.set(name, { name, results: 0, passed: 0, durations: [], flakyRerun: 0, flakyCommit: 0, lastFailure: null, latest: null, latestAt: null });
    return pkgs.get(name);
  };

  for (const run of runs) {
    for (const j of finalJobs(run)) {
      if (!COUNTED.has(j.conclusion)) continue;
      const p = pkg(j.name);
      p.results += 1;
      if (j.conclusion === 'success') p.passed += 1;
      else p.lastFailure = run.createdAt;
      if (j.seconds !== null) p.durations.push(j.seconds);
      // Runs are in date order, so this ends as the package's latest result on main:
      // what its status says now, while the pass rate keeps the history.
      p.latest = j.conclusion;
      p.latestAt = run.createdAt;
    }
  }

  for (const run of all) {
    // Flaky on re-run: an earlier attempt failed and the last one passed.
    for (const j of finalJobs(run)) {
      if (j.conclusion === 'success' && run.jobs.some((o) => o.name === j.name && o.attempt < j.attempt && o.conclusion === 'failure')) {
        pkg(j.name).flakyRerun += 1;
      }
    }
  }

  // Flaky on the same commit: one run failed and another run of the same commit passed.
  const bySha = new Map();
  for (const run of all) {
    for (const j of finalJobs(run)) {
      if (!COUNTED.has(j.conclusion)) continue;
      const key = `${run.sha}|${j.name}`;
      const s = bySha.get(key) ?? new Set();
      s.add(j.conclusion);
      bySha.set(key, s);
    }
  }
  for (const [key, outcomes] of bySha) {
    if (outcomes.has('success') && outcomes.has('failure')) pkg(key.split('|')[1]).flakyCommit += 1;
  }

  const packages = [...pkgs.values()]
    .map((p) => ({
      name: p.name,
      results: p.results,
      passRate: p.results ? Math.round((p.passed / p.results) * 1000) / 10 : null,
      medianSeconds: quantile(p.durations, 0.5),
      p90Seconds: quantile(p.durations, 0.9),
      flaky: p.flakyRerun + p.flakyCommit,
      lastFailure: p.lastFailure,
      latest: p.latest,
      latestAt: p.latestAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const completed = runs.filter((r) => COUNTED.has(r.conclusion));
  const trend = completed.map((r) => {
    const jobs = finalJobs(r).filter((j) => COUNTED.has(j.conclusion));
    return {
      number: r.number,
      createdAt: r.createdAt,
      event: r.event,
      conclusion: r.conclusion,
      jobPassPct: jobs.length ? Math.round((jobs.filter((j) => j.conclusion === 'success').length / jobs.length) * 1000) / 10 : null,
      minutes: r.seconds === null ? null : Math.round((r.seconds / 60) * 10) / 10,
    };
  });

  return {
    overall: {
      branch,
      runs: completed.length,
      // Runs on other branches, read for flaky jobs only.
      otherRuns: all.length - runs.length,
      runPassRate: completed.length ? Math.round((completed.filter((r) => r.conclusion === 'success').length / completed.length) * 1000) / 10 : null,
      medianRunMinutes: quantile(trend.map((t) => t.minutes), 0.5),
      flakyJobs: packages.reduce((n, p) => n + p.flaky, 0),
      failingNow: packages.filter((p) => p.latest === 'failure').length,
      packages: packages.length,
    },
    packages,
    trend,
  };
}
