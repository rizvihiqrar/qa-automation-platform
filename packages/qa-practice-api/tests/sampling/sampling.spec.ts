import { test, expect, request as apiRequest } from '@playwright/test';
import { makeProduct, signUp } from '../design/helpers.ts';
import { plan, sendAll, readPolicy, POLICIES, TOTAL, ERROR_EVERY, type Kept, type Policy, type Sent } from './load.ts';

// Sampling and cost (A434). One load run, 1,000 traces of which every 10th fails, goes
// through a Collector (collector/sampling.yaml) that copies it to three pipelines:
//   all   keeps everything              (the control: what the run really made)
//   head  keeps 10% of traces, chosen from the trace id before anything is known
//   tail  keeps every trace with an error, plus 10% of the others, chosen when the trace is over
// Each policy is checked against the list of traces this file sent, not against the
// Collector's own count of itself.

const out = process.env.SAMPLING_OUT!;
// Chosen in beforeAll, one seed per repeat: with --repeat-each (burn-in) the same ids sent
// again to the same Collector would meet its old files and its old tail decisions.
let sent: Sent[];
let mine: Set<string>;
let failing: Set<string>;
const FAILING = TOTAL / ERROR_EVERY;   // 100
const FINE = TOTAL - FAILING;          // 900
// "About 10%" is a count from a hash, not exactly 10%: allow four standard deviations of
// a fair 10% draw (sqrt(n * 0.1 * 0.9)). The ids are seeded, so the counts are the same on
// every run; the bound says how far a change in the rule may move them, not luck.
const within = (n: number, population: number) => {
  const mean = population * 0.1;
  const spread = 4 * Math.sqrt(population * 0.1 * 0.9);
  return n >= mean - spread && n <= mean + spread;
};

let results: Record<Policy, Map<string, Kept>>;
let statuses: Map<string, number>;

test.describe.configure({ mode: 'serial' });
test.describe('sampling policies on one load run', () => {
  test.skip(!out, 'needs npm run test:sampling (Docker)');

  test.beforeAll(async ({ baseURL }, testInfo) => {
    // The sending and then the poll below (up to 90 s), so the poll's own message is the one that shows.
    test.setTimeout(240_000);
    sent = plan(434 + testInfo.repeatEachIndex);
    mine = new Set(sent.map((s) => s.traceId));
    failing = new Set(sent.filter((s) => s.fails).map((s) => s.traceId));
    // One shopper and one product with stock for every order in the run.
    const api = await apiRequest.newContext({ baseURL: baseURL!, extraHTTPHeaders: { 'Content-Type': 'application/json' } });
    const product = await makeProduct(api, { stock: TOTAL + 10 });
    const buyer = await signUp(api);
    await api.dispose();
    statuses = await sendAll(baseURL!, sent, { auth: buyer.auth.Authorization, productId: product.id });
    // The tail policy holds a trace for decision_wait (2 s) before it decides, so wait until
    // the control file has every trace and the other two files have stopped growing.
    let last = '';
    let stableSince = Date.now();
    await expect.poll(async () => {
      results = Object.fromEntries(POLICIES.map((p) => [p, readPolicy(out, p, mine)])) as typeof results;
      const now = POLICIES.map((p) => `${results[p].size}/${[...results[p].values()].reduce((n, t) => n + t.spans, 0)}`).join(' ');
      if (now !== last) { last = now; stableSince = Date.now(); }
      return results.all.size === TOTAL && Date.now() - stableSince > 5000;
    }, { message: 'the Collector files never settled; is it running, and is the API sending to it?', timeout: 90_000, intervals: [500] }).toBe(true);
  });

  test('SM-01 the control keeps every trace, and exactly the planned ones are marked failed @regression', () => {
    expect(results.all.size).toBe(TOTAL);
    const markedFailed = new Set([...results.all].filter(([, t]) => t.failed).map(([id]) => id));
    expect(markedFailed).toEqual(failing);
    // The API itself answered 500 for exactly those requests, and 201 for the rest.
    for (const s of sent) expect(statuses.get(s.traceId), s.traceId).toBe(s.fails ? 500 : 201);
  });

  test('SM-02 head sampling keeps about 10% of traces, and about 10% of the failing ones too @regression', () => {
    const kept = results.head;
    const failedKept = [...kept.keys()].filter((id) => failing.has(id)).length;
    expect(within(kept.size, TOTAL), `kept ${kept.size} of ${TOTAL}`).toBe(true);
    // The head decision cannot see the error: failing traces are kept at the same rate as the rest.
    // The same rate as the fine ones, not a better one: some failing traces survive (it is a
    // coin flip, not a rule about errors), and most are lost.
    const fineKept = kept.size - failedKept;
    expect(within(fineKept, FINE), `kept ${fineKept} of ${FINE} fine traces`).toBe(true);
    expect(failedKept, `failing traces kept, of ${FAILING}`).toBeGreaterThan(0);
    expect(FAILING - failedKept, 'failing traces lost').toBeGreaterThan(FAILING / 2);
  });

  test('SM-03 tail sampling keeps every failing trace, and about 10% of the others @regression', () => {
    const kept = results.tail;
    const failedKept = [...kept.keys()].filter((id) => failing.has(id)).length;
    const fineKept = kept.size - failedKept;
    expect(failedKept, 'failing traces kept').toBe(FAILING);
    expect(within(fineKept, FINE), `kept ${fineKept} of ${FINE} fine traces`).toBe(true);
    expect([...kept.keys()].every((id) => mine.has(id))).toBe(true);
  });

  test('SM-04 a kept trace is a whole trace: every one of its spans, under both policies @regression', () => {
    for (const policy of ['head', 'tail'] as const) {
      for (const [id, trace] of results[policy]) {
        expect(trace.spans, `${policy}: trace ${id}`).toBe(results.all.get(id)!.spans);
      }
    }
  });

  test('SM-05 the cost: tail keeps a small share of what is made, more than head and far less than everything @regression', () => {
    const total = (p: Policy) => {
      const t = [...results[p].values()];
      return { traces: t.length, spans: t.reduce((n, x) => n + x.spans, 0), bytes: t.reduce((n, x) => n + x.bytes, 0) };
    };
    const all = total('all');
    const head = total('head');
    const tail = total('tail');
    const share = (n: number, of: number) => `${((100 * n) / of).toFixed(1)}%`;
    const table = POLICIES.map((p) => {
      const t = { all, head, tail }[p];
      const failedKept = [...results[p].keys()].filter((id) => failing.has(id)).length;
      return `${p.padEnd(5)} traces ${String(t.traces).padStart(4)}  failing ${String(failedKept).padStart(3)}/${FAILING}  spans ${String(t.spans).padStart(5)} (${share(t.spans, all.spans)})  bytes ${String(t.bytes).padStart(8)} (${share(t.bytes, all.bytes)})`;
    }).join('\n');
    // What one trace weighs, by kind: a failing trace is one span, but it carries the exception.
    const mean = (ids: string[]) => Math.round(ids.reduce((n, id) => n + results.all.get(id)!.bytes, 0) / ids.length);
    const weights = `one failing trace weighs ${mean([...failing])} bytes (1 span); one fine trace ${mean(sent.filter((s) => !s.fails).map((s) => s.traceId))} bytes (4 spans)`;
    console.log(`\nSampling on ${TOTAL} traces, every ${ERROR_EVERY}th failing:\n${table}\n${weights}\n`);
    test.info().annotations.push({ type: 'sampling-table', description: table });

    // Head's cost is about a tenth of everything; tail pays more, for the errors it keeps.
    expect(head.bytes).toBeLessThan(all.bytes * 0.2);
    expect(tail.bytes).toBeGreaterThan(head.bytes);
    expect(tail.bytes).toBeLessThan(all.bytes * 0.3);
    expect(tail.spans).toBeLessThan(all.spans * 0.3);
  });
});
