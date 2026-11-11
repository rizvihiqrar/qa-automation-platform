// Escaped bugs: a bug that got past every check that ran on its change and was found later.
// Two sources feed one list: the root-cause write-ups in docs/rca (classified once in
// data/escaped-bugs.json) and GitHub issues filled in with the escaped-bug issue form.
import fs from 'node:fs';
import path from 'node:path';

/** The kind of check that should have caught the bug, or the place it slipped through. */
export const LAYERS = ['unit', 'integration', 'end-to-end', 'load', 'ci-environment', 'review', 'monitoring'] as const;
export type Layer = (typeof LAYERS)[number];

export interface Entry {
  id: string;
  title: string;
  found: string; // YYYY-MM-DD
  /** True when it reached main past every check on that change. False: a check caught it first. */
  escaped: boolean;
  /** For an escaped bug, the layer that should have caught it. */
  layer: Layer | null;
  /** In words, the test that should have caught it. */
  shouldHaveCaught: string;
  /** Tests added so the bug cannot come back (names, taken from the write-up). */
  testsAdded: string[];
  source: string; // a docs/rca page or an issue link
}

export interface Problem { source: string; message: string }

export interface SeedEntry {
  id: string;
  title: string;
  found: string;
  escaped: boolean;
  layer: Layer | null;
  shouldHaveCaught: string;
  rca: string; // file name under docs/rca
  /** Only the regression tests whose file path contains this text belong to this entry (a page can hold two bugs). */
  testFile?: string;
}

/** The names of the tests a write-up lists under "## Regression tests". */
export function regressionTestsOf(markdown: string): { file: string; name: string }[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line === '## Regression tests');
  if (start === -1) return [];
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .map((line) => line.match(/^- \[`([^`]+)`\]\([^)]*\) › `(.+)`\s*$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ file: m[1]!, name: m[2]! }));
}

const isLayer = (value: string): value is Layer => (LAYERS as readonly string[]).includes(value);

/** The seed file, with each entry's tests read from its write-up. */
export function loadSeed(root: string, seed: SeedEntry[]): Entry[] {
  return seed.map((s) => {
    const page = fs.readFileSync(path.join(root, 'docs', 'rca', s.rca), 'utf8');
    const tests = regressionTestsOf(page).filter((t) => !s.testFile || t.file.includes(s.testFile));
    return {
      id: s.id,
      title: s.title,
      found: s.found,
      escaped: s.escaped,
      layer: s.layer,
      shouldHaveCaught: s.shouldHaveCaught,
      testsAdded: tests.map((t) => t.name),
      source: `docs/rca/${s.rca}`,
    };
  });
}

export interface IssueLike { number: number; title: string; body?: string | null; created_at: string; html_url: string }

/** The answer under one "### Heading" of an issue form, or null when it is missing or left blank. */
export function formField(body: string, heading: string): string | null {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `### ${heading}`);
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && line.startsWith('### '));
  const text = lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
  return text === '' || text === '_No response_' ? null : text;
}

/** Headings of the issue form, in .github/ISSUE_TEMPLATE/escaped-bug.yml. */
export const FORM = { layer: 'Which layer missed it', shouldHave: 'Which test should have caught it', added: 'Test added', found: 'Date found' } as const;

/**
 * One issue labelled escaped-bug as an entry. An issue missing the layer, the test that should
 * have caught it or the test added is a problem, not a quiet zero: the report lists it.
 */
export function parseIssue(issue: IssueLike): { entry: Entry } | { problem: Problem } {
  const source = issue.html_url;
  const body = issue.body ?? '';
  const layer = formField(body, FORM.layer);
  if (layer === null || !isLayer(layer)) return { problem: { source, message: `#${issue.number}: "${FORM.layer}" must be one of ${LAYERS.join(', ')}` } };
  const shouldHave = formField(body, FORM.shouldHave);
  if (shouldHave === null) return { problem: { source, message: `#${issue.number}: "${FORM.shouldHave}" is empty` } };
  const added = formField(body, FORM.added);
  const foundOn = formField(body, FORM.found);
  if (foundOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(foundOn)) return { problem: { source, message: `#${issue.number}: "${FORM.found}" must look like 2026-11-05, or be left blank` } };
  return {
    entry: {
      id: `issue-${issue.number}`,
      title: issue.title,
      found: foundOn ?? issue.created_at.slice(0, 10),
      escaped: true,
      layer,
      shouldHaveCaught: shouldHave,
      testsAdded: added === null ? [] : [added],
      source,
    },
  };
}

export interface EscapedSummary {
  escaped: Entry[];
  caughtBeforeMain: number;
  byLayer: { layer: Layer; count: number }[];
  /** Escaped bugs with no test added yet: the part of the list that still needs work. */
  withoutTest: Entry[];
}

export function summarize(entries: Entry[], month: string): EscapedSummary {
  const inMonth = entries.filter((e) => e.found.startsWith(`${month}-`));
  const escaped = inMonth.filter((e) => e.escaped);
  const byLayer = LAYERS.map((layer) => ({ layer, count: escaped.filter((e) => e.layer === layer).length })).filter((row) => row.count > 0);
  return {
    escaped,
    caughtBeforeMain: inMonth.length - escaped.length,
    byLayer,
    withoutTest: escaped.filter((e) => e.testsAdded.length === 0),
  };
}
