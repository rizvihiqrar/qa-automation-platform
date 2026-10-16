import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validate, findOperation, checkResponse } from '../src/schema.js';

const spec = JSON.parse(fs.readFileSync(new URL('../spec/qa-practice-api.openapi.json', import.meta.url), 'utf8'));
const user = { id: 1, name: 'A', email: 'a@example.com', role: 'user', created_at: '2026-10-16T08:00:00.000Z' };
const kinds = (issues) => issues.map((i) => i.kind);
const userRef = { $ref: '#/components/schemas/User' };

test('a valid object has no issues', () => {
  assert.deepEqual(validate(spec, userRef, user), []);
});

test('a leaked extra field is reported (additionalProperties: false)', () => {
  const issues = validate(spec, userRef, { ...user, password: '$2a$10$hash' });
  assert.deepEqual(issues, [{ kind: 'extra', path: '$.password', message: 'field "password" is not in the spec' }]);
});

test('missing fields, wrong types, bad enums, ranges and dates are all reported together', () => {
  const issues = validate(spec, userRef, { id: '1', name: 'A', role: 'owner', created_at: 'yesterday' });
  assert.deepEqual(kinds(issues).sort(), ['enum', 'format', 'missing', 'type']);
  assert.deepEqual(kinds(validate(spec, { $ref: '#/components/schemas/Product' }, { id: 1, name: 'n', category: 'c', price: 5, stock: -1, created_at: user.created_at })), ['range']);
});

test('null is a type error unless the schema is nullable', () => {
  assert.equal(validate(spec, { type: 'number' }, null)[0].kind, 'type');
  assert.deepEqual(validate(spec, { type: 'number', nullable: true }, null), []);
});

test('integers are accepted where numbers are expected, but not the other way round', () => {
  assert.deepEqual(validate(spec, { type: 'number' }, 5), []);
  assert.equal(validate(spec, { type: 'integer' }, 5.5)[0].kind, 'type');
});

test('array items are checked with their index in the path', () => {
  const issues = validate(spec, { type: 'array', items: userRef }, [user, { ...user, role: 'guest' }]);
  assert.deepEqual(issues.map((i) => i.path), ['$[1].role']);
});

test('nested $refs are followed', () => {
  const issues = validate(spec, { $ref: '#/components/schemas/AuthResult' }, { user: { ...user, password: 'x' }, token: 't' });
  assert.deepEqual(issues.map((i) => i.path), ['$.user.password']);
});

test('findOperation matches path templates exactly', () => {
  assert.equal(findOperation(spec, 'GET', '/orders/7').template, '/orders/{id}');
  assert.equal(findOperation(spec, 'PATCH', '/orders/7/status').template, '/orders/{id}/status');
  assert.equal(findOperation(spec, 'GET', '/products?page=2').template, '/products');
  assert.equal(findOperation(spec, 'DELETE', '/orders/7'), null);
});

test('checkResponse reports undocumented endpoints and status codes', () => {
  assert.equal(checkResponse(spec, { method: 'GET', path: '/admin', status: 200, body: {} })[0].kind, 'undocumented-endpoint');
  const [issue] = checkResponse(spec, { method: 'GET', path: '/products/1', status: 500, body: { error: 'x' } });
  assert.equal(issue.kind, 'undocumented-status');
  assert.match(issue.message, /documented: 200, 404/);
});

test('checkResponse validates the body for the returned status', () => {
  assert.deepEqual(checkResponse(spec, { method: 'GET', path: '/products/9', status: 404, body: { error: 'Product 9 not found' } }), []);
  assert.equal(checkResponse(spec, { method: 'GET', path: '/products/9', status: 404, body: { message: 'nope' } }).length, 2);
});

test('an unresolvable $ref throws a clear error', () => {
  assert.throws(() => validate(spec, { $ref: '#/components/schemas/Nope' }, {}), /Unresolved \$ref/);
});
