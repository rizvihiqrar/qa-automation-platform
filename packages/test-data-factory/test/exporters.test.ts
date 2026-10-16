import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsvString } from '../src/exporters/csvExporter.ts';
import { toSqlString } from '../src/exporters/sqlExporter.ts';
import { toJsonString } from '../src/exporters/jsonExporter.ts';

const records = [
  { id: 1, name: 'Widget, large', note: 'says "hi"', active: true, address: { city: 'Ajax', zip: 'L1S' }, shippedAt: null },
  { id: 2, name: "O'Brien", note: 'line1\nline2', active: false, address: { city: 'Toronto', zip: 'M5V' }, shippedAt: null },
];

test('CSV flattens nested objects into prefixed columns', () => {
  const [header] = toCsvString(records).split('\n');
  assert.equal(header, 'id,name,note,active,address_city,address_zip,shippedAt');
});

test('CSV quotes values with commas, quotes or newlines', () => {
  const csv = toCsvString(records);
  assert.ok(csv.includes('"Widget, large"'));
  assert.ok(csv.includes('"says ""hi"""'));
  assert.ok(csv.includes('"line1\nline2"'));
});

test('CSV writes null as an empty field', () => {
  const firstRow = toCsvString(records).split('\n')[1];
  assert.ok(firstRow);
  assert.ok(firstRow.endsWith(','), firstRow);
});

test('CSV and SQL return an empty string for no records', () => {
  assert.equal(toCsvString([]), '');
  assert.equal(toSqlString([]), '');
});

test('SQL escapes single quotes and maps booleans and nulls', () => {
  const sql = toSqlString(records, 'test_users');
  assert.match(sql, /^INSERT INTO `test_users` \(`id`, `name`, `note`, `active`, `address`, `shippedAt`\)/);
  assert.ok(sql.includes("'O''Brien'"));
  assert.ok(sql.includes("(1, 'Widget, large', 'says \"hi\"', 1, "));
  assert.ok(sql.includes(', 0, '));
  assert.ok(sql.trimEnd().endsWith('NULL);'));
});

test('SQL stores nested objects as escaped JSON text', () => {
  assert.ok(toSqlString(records).includes(`'{"city":"Ajax","zip":"L1S"}'`));
});

test('JSON output round-trips', () => {
  assert.deepEqual(JSON.parse(toJsonString(records)), records);
});
