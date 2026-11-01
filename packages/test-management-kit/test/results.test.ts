import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateResults } from '../src/results.ts';
import { makeSuite } from './helpers.ts';

const check = (file: unknown) => validateResults(file, makeSuite()).map((i) => i.id + ' ' + i.field + ': ' + i.message);
const one = (entry: Record<string, unknown>) => ({ runId: 7, results: [{ caseId: 'AAA-001', status: 'passed', ...entry }] });

describe('validateResults', () => {
  test('accepts a good file', () => {
    assert.deepEqual(check({ runId: 7, results: [{ caseId: 'AAA-001', status: 'passed', elapsed: '1m 5s' }, { caseId: 'AAA-002', status: 'failed', steps: ['a', 'b'], evidence: ['x.png'] }] }), []);
  });

  test('rejects a file without a results list', () => {
    assert.deepEqual(check({}), ['(file) results: The results file needs a "results" list']);
    assert.deepEqual(check(null), ['(file) results: The results file needs a "results" list']);
    assert.deepEqual(check([]), ['(file) results: The results file needs a "results" list']);
  });

  test('rejects an empty list', () => assert.deepEqual(check({ results: [] }), ['(file) results: The results list is empty']));
  test('rejects a bad runId', () => assert.deepEqual(check({ ...one({}), runId: 0 }), ['(file) runId: runId must be a positive whole number']));
  test('rejects a case that is not in the suite', () => assert.deepEqual(check(one({ caseId: 'ZZZ-001' })), ['ZZZ-001 caseId: No such case in the suite']));
  test('rejects a missing caseId', () => assert.deepEqual(check(one({ caseId: '' })), ['(result 1) caseId: Missing caseId']));
  test('rejects a status that is not allowed', () => assert.deepEqual(check(one({ status: 'skipped' })), ['AAA-001 status: Status must be one of passed, blocked, retest, failed']));
  test('rejects a case reported twice', () => {
    assert.deepEqual(check({ results: [{ caseId: 'AAA-001', status: 'passed' }, { caseId: 'AAA-001', status: 'failed' }] }), ['AAA-001 caseId: Reported twice']);
  });
  test('rejects an elapsed time TestRail would not read', () => {
    assert.deepEqual(check(one({ elapsed: '90 seconds' })), ['AAA-001 elapsed: Use the form 30s or 1m 45s']);
    assert.deepEqual(check(one({ elapsed: '' })), ['AAA-001 elapsed: Use the form 30s or 1m 45s']);
  });
  test('rejects text fields that are not text and lists that are not lists', () => {
    assert.deepEqual(check(one({ comment: 5, steps: 'one step', evidence: [1] })), ['AAA-001 comment: comment must be text', 'AAA-001 steps: steps must be a list of text', 'AAA-001 evidence: evidence must be a list of text']);
  });
  test('rejects a result that is not an object', () => assert.deepEqual(check({ results: ['AAA-001'] }), ['(result 1) result: Each result must be an object']));
});
