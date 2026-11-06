import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startApi } from '../scripts/api.ts';
import { COLLECTION, PLANS, ROOT, reportsWithTokens, runPass } from '../scripts/newman-run.ts';
import { BREAKS } from '../scripts/breaks.ts';

// Guards for the Postman files themselves. A Postman test with no assertion in it passes
// and proves nothing, and a saved token in a file would be published with the repo.

interface Script { listen: string; script: { exec: string[] } }
interface Item { name: string; item?: Item[]; event?: Script[]; request?: { auth?: { type: string }; header: { key: string; value: string }[] } }
interface Variable { key: string; value: string }

const collection = JSON.parse(readFileSync(COLLECTION, 'utf8')) as { item: Item[]; event: Script[]; variable: Variable[] };
const requests = (items: Item[]): Item[] => items.flatMap((item) => (item.item ? requests(item.item) : [item]));
const script = (item: Item, listen: string): string => (item.event ?? []).filter((event) => event.listen === listen).flatMap((event) => event.script.exec).join('\n');
const allRequests = requests(collection.item);

// The text of each pm.test(...) call, found by matching its brackets.
export function pmTests(source: string): string[] {
  const found: string[] = [];
  for (let at = source.indexOf('pm.test('); at !== -1; at = source.indexOf('pm.test(', at + 1)) {
    let depth = 0;
    for (let end = at + 'pm.test'.length; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      if (source[end] === ')') depth -= 1;
      if (depth === 0) {
        found.push(source.slice(at, end + 1));
        break;
      }
    }
  }
  return found;
}

const asserts = (body: string): boolean => /pm\.expect\(|pm\.response\.to\./.test(body);

test('the guard itself tells an empty test from a real one', () => {
  assert.equal(asserts(`pm.test('nothing', () => {})`), false);
  assert.equal(asserts(`pm.test('x', () => pm.response.to.have.status(200))`), true);
  assert.deepEqual(pmTests(`a; pm.test('one (1)', () => f(g())); b; pm.test('two', () => {});`), [`pm.test('one (1)', () => f(g()))`, `pm.test('two', () => {})`]);
});

test('every request has at least one pm.test', () => {
  const none = allRequests.filter((item) => pmTests(script(item, 'test')).length === 0).map((item) => item.name);
  assert.deepEqual(none, []);
});

test('every pm.test in the collection asserts something', () => {
  const scripts = [...allRequests.map((item) => script(item, 'test')), collection.event.filter((event) => event.listen === 'test').flatMap((event) => event.script.exec).join('\n')];
  const empty = scripts.flatMap(pmTests).filter((body) => !asserts(body));
  assert.deepEqual(empty, []);
});

test('the folders are the ones the plans run', () => {
  const planned = new Set(Object.values(PLANS).flat().flatMap((pass) => pass.folders));
  const folders = (items: Item[]): string[] => items.filter((item) => item.item).flatMap((item) => [item.name, ...folders(item.item!)]);
  for (const name of planned) assert.ok(folders(collection.item).includes(name), `${name} is not in the collection`);
  assert.ok(planned.has('Orders from CSV') && planned.has('Cards from JSON'));
});

test('no file holds a token: variables start empty, environments hold only the base URL', () => {
  for (const variable of collection.variable.filter(({ key }) => /token/i.test(key))) assert.equal(variable.value, '', variable.key);
  const files = readdirSync(`${ROOT}postman`).map((file) => readFileSync(`${ROOT}postman/${file}`, 'utf8'));
  for (const text of files) assert.doesNotMatch(text, /Bearer [A-Za-z0-9._~+/-]{20,}|\b[0-9a-f]{64}\b/);
  for (const file of readdirSync(`${ROOT}postman`).filter((name) => name.endsWith('environment.json'))) {
    const { values } = JSON.parse(readFileSync(`${ROOT}postman/${file}`, 'utf8')) as { values: Variable[] };
    assert.deepEqual(values.map(({ key }) => key), ['baseUrl'], file);
  }
});

test('a report holding a token is named', () => {
  const dir = mkdtempSync(join(tmpdir(), 'food-truck-reports-'));
  try {
    writeFileSync(join(dir, 'clean.html'), 'status 200');
    writeFileSync(join(dir, 'leaky.html'), `{"token":"${'ab'.repeat(32)}"}`);
    assert.deepEqual(reportsWithTokens(dir), ['leaky.html']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the schemas refuse a field they do not know', () => {
  for (const name of ['schemaMenuItem', 'schemaOrder', 'schemaPayment']) {
    const schema = JSON.parse(collection.variable.find(({ key }) => key === name)!.value) as { additionalProperties: boolean; required: string[] };
    assert.equal(schema.additionalProperties, false, name);
    assert.ok(schema.required.length > 0, name);
  }
});

test('every planted bug names a check that exists', () => {
  const names = allRequests.map((item) => item.name);
  for (const planted of BREAKS.filter((item) => item.suite === 'postman')) assert.ok(names.includes(planted.caughtBy), planted.caughtBy);
  assert.ok(BREAKS.length >= 7);
});

test('the whole collection, run with no data file, passes and leaves the data folders out', async () => {
  const api = await startApi(`${ROOT}src`);
  try {
    const result = await runPass({ name: 'no-data', folders: [] }, api.baseUrl, { quiet: true });
    assert.deepEqual(result.failed, []);
    const dataFolder = collection.item.find((item) => item.name.startsWith('07'))!;
    assert.equal(result.requests, allRequests.length - requests([dataFolder]).length);
  } finally {
    api.stop();
  }
});
