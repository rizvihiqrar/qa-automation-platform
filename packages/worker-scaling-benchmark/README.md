# worker-scaling-benchmark

A small Node.js CLI that runs a Playwright suite at several worker counts and shows how runtime, pass counts, and flaky results change as you add workers.

**In plain English:** Running tests in parallel should make them faster, but past a point it can make them slower or less reliable. This measures where that point is.

Adding workers is the first thing most teams try when a suite is slow. This tool measures whether it helps, and it shows when extra workers add contention instead of speed.

No dependencies. Written in TypeScript; requires Node 24 or later (it runs the `.ts` files directly) and a Playwright project with `npx playwright` available.

---

## Usage

```bash
node src/bench.ts --dir path/to/playwright-project --workers 1,2,4 --runs 3
```

| Option | Default | Meaning |
|---|---|---|
| `--dir` | required | Folder containing the Playwright project |
| `--workers` | `1,2,4` | Worker counts to compare, comma-separated |
| `--runs` | `1` | Repeats per worker count. The median is reported. |

Each run executes `npx playwright test --workers=N --reporter=line`. Output is a Markdown table.

---

## Metrics

| Column | Meaning |
|---|---|
| Median time | Wall-clock seconds for the whole suite, median across runs |
| Speedup | Baseline time divided by this row's time. The baseline is the lowest worker count. |
| Efficiency | Speedup divided by worker multiplier. 100% is perfect scaling. |
| Passed / Flaky / Failed | From the last run. A flaky test passed only after a retry. |

---

## Sample Result

Run against [playwright-demo-suite](https://github.com/rizvihiqrar/playwright-demo-suite) on the public Sauce Demo site, headless, with 2 retries configured. One run per worker count.

| Workers | Median time (s) | Speedup | Efficiency | Passed | Flaky | Failed |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 44.5 | 1.00x | 100% | 14 | 2 | 0 |
| 2 | 58.0 | 0.77x | 38% | 12 | 4 | 0 |
| 4 | 59.1 | 0.75x | 19% | 10 | 6 | 0 |

**Reading the result:** Adding workers made the suite slower and increased flaky results from 2 to 6. The browsers and the shared site were competing for the same resources, so each extra worker slowed the others down.

**Caveat:** The target is a public site that other people use, so some of the contention comes from outside the test runner. The pattern is still the same one that shows up when parallel runs share a test environment: more workers add contention before they add speed.

---

## Project Structure

```
├── src/
│   ├── bench.ts       # Runs the suite at each worker count and collects timings
│   ├── parse.ts       # Reads pass, flaky, and fail counts; parses arguments
│   └── summarize.ts   # Medians, speedup, efficiency, Markdown output
└── test/
    └── benchmark.test.ts
```

---

## Tests

```bash
npm test   # 12 tests, Node built-in test runner
```

The tests cover the median calculation, baseline and efficiency math, repeated runs, ANSI-stripped output parsing, flaky counts, and argument validation. They don't launch Playwright. The benchmark itself is run against a real suite, as in the sample above.

---

## Limits

- Results depend on the machine, the network, and the target's load. Compare runs made under the same conditions.
- With one run per worker count, timings are noisy. Use `--runs 3` or more before drawing conclusions.
- The tool measures the suite as a whole. It doesn't show which test is slow. Playwright's own HTML report does that.
