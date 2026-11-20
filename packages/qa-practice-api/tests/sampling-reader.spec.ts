import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { plan, readPolicy, TOTAL, ERROR_EVERY } from './sampling/load.ts';

// The readers behind tests/sampling, checked on their own (no Docker): the sampling tests
// are only as good as what they read back from the Collector's files.

const span = (traceId: string, code?: number) => ({ traceId, spanId: 'a1', name: 'x', ...(code === undefined ? {} : { status: { code } }) });
const batch = (...spans: object[]) => JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans }] }] });

function folderWith(file: string, text: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sampling-reader-'));
  writeFileSync(path.join(dir, file), text);
  return dir;
}

test.describe('the sampling readers', () => {
  test('SM-06 the plan is the same on every call, with 1,000 unique trace ids of which every 10th fails @regression', () => {
    const a = plan();
    expect(plan()).toEqual(a);
    expect(a).toHaveLength(TOTAL);
    expect(new Set(a.map((s) => s.traceId)).size).toBe(TOTAL);
    expect(a.every((s) => /^[0-9a-f]{32}$/.test(s.traceId))).toBe(true);
    expect(a.filter((s) => s.fails)).toHaveLength(TOTAL / ERROR_EVERY);
    expect(plan(435)[0]!.traceId).not.toBe(a[0]!.traceId);
  });

  test('SM-07 it counts the spans and bytes of each trace, and marks a trace failed when any span is @regression', () => {
    const dir = folderWith('all.jsonl', [batch(span('t1'), span('t1', 2)), batch(span('t2', 1))].join('\n') + '\n');
    try {
      const traces = readPolicy(dir, 'all', new Set(['t1', 't2']));
      expect(traces.get('t1')).toMatchObject({ spans: 2, failed: true });
      expect(traces.get('t2')).toMatchObject({ spans: 1, failed: false });
      expect(traces.get('t1')!.bytes).toBeGreaterThan(traces.get('t2')!.bytes);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('SM-08 it ignores spans of traces that are not in the run (a health probe, another test) @regression', () => {
    const dir = folderWith('all.jsonl', batch(span('mine'), span('stranger')) + '\n');
    try {
      expect([...readPolicy(dir, 'all', new Set(['mine'])).keys()]).toEqual(['mine']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('SM-09 a last line still being written is skipped, not an error; a broken line before it is @regression', () => {
    const whole = batch(span('t1'));
    const torn = whole.slice(0, 20);
    const dir = folderWith('head.jsonl', `${whole}\n${torn}`);
    const broken = folderWith('head.jsonl', `${torn}\n${whole}\n`);
    try {
      expect([...readPolicy(dir, 'head', new Set(['t1'])).keys()]).toEqual(['t1']);
      expect(() => readPolicy(broken, 'head', new Set(['t1']))).toThrow(SyntaxError);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(broken, { recursive: true, force: true }); }
  });

  test('SM-10 a file that is not there yet reads as no traces @regression', () => {
    expect(readPolicy(path.join(tmpdir(), 'no-such-sampling-folder'), 'tail', new Set(['t1'])).size).toBe(0);
  });
});
