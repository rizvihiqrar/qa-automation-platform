import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLine, parseLog, signature, groupEntries, compareGroups } from '../src/logs.js';

const read = (name) => fs.readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8');

test('parseLine reads the plain format with and without a service', () => {
  assert.deepEqual(parseLine('2026-10-16T08:00:00.950Z ERROR [api] Boom'), { timestamp: '2026-10-16T08:00:00.950Z', level: 'ERROR', service: 'api', message: 'Boom' });
  assert.equal(parseLine('2026-10-16 08:00:00 warn no service here').service, null);
  assert.equal(parseLine('2026-10-16 08:00:00 warn no service here').level, 'WARN');
});

test('parseLine reads JSON lines and maps level names', () => {
  const e = parseLine('{"time":"t1","level":"warning","service":"db","msg":"slow"}');
  assert.deepEqual(e, { timestamp: 't1', level: 'WARN', service: 'db', message: 'slow' });
  assert.equal(parseLine('{"severity":"CRITICAL","message":"x"}').level, 'FATAL');
});

test('parseLine finds a level anywhere in an unstructured line, else UNKNOWN', () => {
  assert.equal(parseLine('something went ERROR here').level, 'ERROR');
  assert.equal(parseLine('just text').level, 'UNKNOWN');
  assert.equal(parseLine('   '), null);
});

test('stack-trace lines attach to the entry above instead of becoming entries', () => {
  const entries = parseLog('2026-10-16T08:00:00Z ERROR [x] TypeError: boom\n    at a (f.js:1:2)\n    at b (g.js:3:4)\n2026-10-16T08:00:01Z INFO [x] next');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].detail, ['at a (f.js:1:2)', 'at b (g.js:3:4)']);
});

test('signature masks the variable parts of a message', () => {
  assert.equal(signature('Timeout after 3000ms for order 8f2a91c4-5b1e-4c3a-9e2d-7a6b0c1d2e3f'), 'Timeout after <num>ms for order <uuid>');
  assert.equal(signature('User not found: ana.silva@example.com'), 'User not found: <email>');
  assert.equal(signature('Connection refused to 10.0.4.17:5432'), 'Connection refused to <ip>');
  assert.equal(signature("Cannot read properties of undefined (reading 'total')"), 'Cannot read properties of undefined (reading <str>)');
  assert.equal(signature('Retry at 2026-10-16T08:00:00Z, job a1b2c3d4e5f6'), 'Retry at <ts>, job <hex>');
  assert.equal(signature('Pool 80% full (16/20)'), 'Pool <num>% full (<num>/<num>)');
});

test('messages that differ only in values share a signature', () => {
  assert.equal(signature('User 42 paid 19.99'), signature('User 7 paid 250.00'));
  assert.notEqual(signature('User 42 paid 19.99'), signature('User 42 refunded 19.99'));
});

test('groupEntries counts patterns per level, most frequent first, and filters levels', () => {
  const groups = groupEntries(parseLog(read('app-2026-10-16.log')));
  assert.deepEqual(groups.map((g) => [g.count, g.level, g.signature]), [
    [5, 'ERROR', 'Timeout calling bank API after <num>ms for order <uuid>'],
    [3, 'ERROR', 'TypeError: Cannot read properties of undefined (reading <str>)'],
    [1, 'ERROR', 'User not found: <email>'],
    [1, 'WARN', 'Bank API slow: responded in <num>ms for order <uuid>'],
    [1, 'WARN', 'Connection pool <num>% full (<num>/<num>)'],
  ]);
  assert.deepEqual(groups[1].services, ['checkout']);
  assert.equal(groupEntries(parseLog(read('app-2026-10-16.log')), { levels: ['WARN'] }).length, 2);
});

test('a group records first and last seen times', () => {
  const [timeouts] = groupEntries(parseLog(read('app-2026-10-16.log')));
  assert.equal(timeouts.firstSeen, '2026-10-16T08:01:12.300Z');
  assert.equal(timeouts.lastSeen, '2026-10-16T08:04:58.019Z');
});

test('compareGroups finds new, grown and gone patterns', () => {
  const before = groupEntries(parseLog(read('app-2026-10-15.log')));
  const after = groupEntries(parseLog(read('app-2026-10-16.log')));
  const diff = compareGroups(before, after);
  assert.deepEqual(diff.new.map((g) => g.signature), ['TypeError: Cannot read properties of undefined (reading <str>)']);
  assert.deepEqual(diff.gone.map((g) => g.signature), ['Connection refused to <ip>']);
  assert.deepEqual(diff.grew.map((g) => [g.before, g.count]), [[2, 5]]);
});

test('small changes do not count as growth', () => {
  const g = (count) => [{ key: 'ERROR x', level: 'ERROR', signature: 'x', count, services: [] }];
  assert.equal(compareGroups(g(1), g(2)).grew.length, 0); // doubled, but only +1
  assert.equal(compareGroups(g(10), g(15)).grew.length, 0); // +5, but not doubled
});
