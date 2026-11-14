import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applySeed, parseArgs } from '../src/index.ts';
import { generateUsers } from '../src/generators/userGenerator.ts';
import { generateOrders } from '../src/generators/orderGenerator.ts';
import { generateProducts } from '../src/generators/productGenerator.ts';
import { checkRunName, findCollisions, hash32, runCode, runSeed, stampRun } from '../src/isolation.ts';
import { measure, type Measurement } from '../src/parallel.ts';

const CLI = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// One measurement per type, the one the README table shows: 4 workers, 25 records, seed 42.
const measured: Partial<Record<'users' | 'orders' | 'products', Measurement>> = {};
before(async () => {
  for (const type of ['users', 'orders', 'products'] as const) measured[type] = await measure(type);
});

test('ISO-01 the same seed gives the same data to every worker when no --run is given, so they collide (the README numbers)', () => {
  // users share id, email and username (3 x 25); orders their order id and user id; products their id and SKU
  assert.deepEqual([measured.users!.withoutRun.length, measured.orders!.withoutRun.length, measured.products!.withoutRun.length], [75, 50, 50]);
  for (const m of Object.values(measured)) assert.ok(m!.withoutRun.every((c) => c.runs.length === 4), `${m!.type}: all four workers hold each shared key`);
});

test('ISO-02 with --run, four workers on the same seed share no id, email, username or SKU', () => {
  for (const m of Object.values(measured)) assert.deepEqual(m!.withRun, [], m!.type);
});

test('ISO-03 a run is reproducible: the same seed and run name print identical data, another run name does not', () => {
  const a = cli('--type', 'users', '--count', '5', '--seed', '9', '--run', 'w1');
  const b = cli('--type', 'users', '--count', '5', '--seed', '9', '--run', 'w1');
  const other = cli('--type', 'users', '--count', '5', '--seed', '9', '--run', 'w2');
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.notEqual(a.stdout, other.stdout);
});

test('ISO-04 without --run the output is exactly what it was before (existing seeds keep their data)', () => {
  const plain = cli('--type', 'orders', '--count', '3', '--seed', '7');
  applySeed(7);
  assert.deepEqual(JSON.parse(plain.stdout), JSON.parse(JSON.stringify(generateOrders(3))));
});

test('ISO-05 run names mix into the seed deterministically and differently', () => {
  assert.equal(runSeed(42, 'a'), runSeed(42, 'a'));
  const seeds = new Set(Array.from({ length: 200 }, (_, i) => runSeed(42, `worker-${i}`)));
  assert.equal(seeds.size, 200);
  assert.equal(hash32('a'), 0xe40c292c); // FNV-1a of "a": fixed, so a seed means the same on every machine
});

test('ISO-11 the longest run name still gives a short email local part and username', () => {
  applySeed(2);
  const longest = 'x'.repeat(16);
  for (const u of stampRun(generateUsers(50), longest)) {
    assert.ok(u.email.split('@')[0]!.length <= 64, u.email);
    assert.ok(u.username.length <= 64, u.username);
  }
});

test('ISO-06 stamping keeps every record valid: uuids, email format, SKU length, and the fields that are not keys', () => {
  applySeed(5);
  const users = generateUsers(10);
  const stamped = stampRun(users, 'w7');
  for (const [i, u] of stamped.entries()) {
    assert.match(u.id, UUID);
    assert.ok(u.id.startsWith(runCode('w7')));
    assert.match(u.email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
    assert.ok(u.email.includes('.w7@'));
    assert.ok(u.username.endsWith('.w7'));
    assert.equal(u.firstName, users[i]!.firstName);
    assert.equal(u.createdAt, users[i]!.createdAt);
  }
  const orders = stampRun(generateOrders(10), 'w7');
  for (const o of orders) { assert.match(o.orderId, UUID); assert.match(o.userId, UUID); assert.equal(o.total, parseFloat((o.quantity * o.unitPrice).toFixed(2))); }
  for (const p of stampRun(generateProducts(10), 'w7')) { assert.equal(p.sku.length, 8); assert.match(p.id, UUID); }
});

test('ISO-07 two different run names cannot produce the same key, whatever the random numbers were', () => {
  // The same records stamped by two runs: nothing is shared, because the stamp differs.
  applySeed(1);
  const records = generateUsers(50);
  assert.deepEqual(findCollisions({ a: stampRun(records, 'run-a'), b: stampRun(records, 'run-b') }), []);
  assert.notEqual(runCode('run-a'), runCode('run-b'));
});

test('ISO-08 findCollisions lists each shared key with its runs, and ignores repeats inside one run', () => {
  const a = [{ id: 'x', email: 'e1' }, { id: 'x', email: 'e2' }];     // x twice in one run: not a collision between runs
  const b = [{ id: 'y', email: 'e1' }];
  const c = [{ id: 'z', email: 'e1' }];
  assert.deepEqual(findCollisions({ a, b, c }), [{ field: 'email', value: 'e1', runs: ['a', 'b', 'c'] }]);
  assert.deepEqual(findCollisions({}), []);
});

test('ISO-09 --run must be a short lower-case name', () => {
  assert.equal(checkRunName('worker-3'), 'worker-3');
  assert.equal(checkRunName('x'.repeat(16)), 'x'.repeat(16));
  for (const bad of ['', 'Worker', 'a b', '-x', 'x'.repeat(17), 'a@b']) assert.throws(() => checkRunName(bad), /--run must be/, bad);
  assert.equal(parseArgs(['--run', 'w1']).run, 'w1');
  assert.notEqual(cli('--run', 'Bad Name').status, 0);
});

test('ISO-10 --run works with CSV and SQL output', () => {
  assert.equal(cli('--type', 'products', '--count', '2', '--seed', '3', '--run', 'w1', '--format', 'csv').status, 0);
  const sql = cli('--type', 'users', '--count', '2', '--seed', '3', '--run', 'w1', '--format', 'sql');
  assert.equal(sql.status, 0, sql.stderr);
  assert.match(sql.stdout, /\.w1@/);
});
