import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { packageRoot } from '../src/build.ts';
import { checkGates, gatesMarkdown, readGates, type Gate } from '../src/gates.ts';

const gate = (over: Partial<Gate> = {}): Gate => ({
  id: 'g', gate: 'A gate', threshold: 'fails over 3', blocks: true, owner: 'Someone', enforcedIn: 'f.yml',
  checks: [{ pattern: 'limit: 3', count: 1 }], ...over,
});
const files = (text: string | null) => () => text;

test('every gate in the policy file matches the file that enforces it', () => {
  assert.deepEqual(checkGates(readGates()), []);
});

test('a threshold that changed in the workflow is reported', () => {
  assert.match(checkGates([gate()], files('limit: 5'))[0]!, /g: "limit: 3" appears 0 times in f\.yml, the policy says 1/);
});

test('a gate copied into a second job the policy does not list is reported', () => {
  assert.match(checkGates([gate()], files('limit: 3\nlimit: 3'))[0]!, /appears 2 times/);
});

test('a gate whose file was moved or deleted is reported', () => {
  assert.deepEqual(checkGates([gate()], files(null)), ['g: f.yml does not exist']);
});

test('a gate with no owner, no threshold or no check is reported, and so is a repeated id', () => {
  assert.match(checkGates([gate({ owner: ' ' })], files('limit: 3'))[0]!, /needs an owner/);
  assert.match(checkGates([gate({ checks: [] })], files(''))[0]!, /needs an owner/);
  assert.deepEqual(checkGates([gate(), gate()], files('limit: 3')), ['g: listed twice']);
});

test('the page lists every gate and says which ones only report', () => {
  const md = gatesMarkdown([gate(), gate({ id: 'h', gate: 'Soft gate', blocks: false })]);
  assert.ok(md.includes('| A gate | fails over 3 | Blocks the job | Someone | `f.yml` |'));
  assert.ok(md.includes('| Soft gate | fails over 3 | Reported only |'));
});

test('docs/gates.md is the current output (run npm run policy)', () => {
  assert.equal(fs.readFileSync(path.join(packageRoot, 'docs', 'gates.md'), 'utf8'), gatesMarkdown(readGates()));
});
