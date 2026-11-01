import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { basicAuth } from '../src/http.ts';
import { startMock } from '../src/mock.ts';
import type { MockServer } from '../src/mock.ts';
import { buildResults, planAddResults, reportResults, STATUS_IDS, validateMap } from '../src/testrail.ts';
import type { CaseResult } from '../src/results.ts';
import { makeSuite } from './helpers.ts';

const map = { 'AAA-001': 101, 'AAA-002': 102, 'BBB-001': 103, 'BBB-002': 104 };
const connection = (baseUrl: string) => ({ baseUrl, user: 'qa@example.com', apiKey: 'good-key' });
const noWait = async () => {};

let mock: MockServer | undefined;
const start = async (rateLimitFirst = 0) => {
  mock = await startMock({ testrail: { user: 'qa@example.com', apiKey: 'good-key', runs: { 7: [101, 102, 103] } }, rateLimitFirst });
  return mock;
};
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe('basicAuth', () => {
  test('matches the worked example in the Basic authentication standard (RFC 7617)', () => {
    assert.equal(basicAuth('Aladdin', 'open sesame'), 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
  });
});

describe('buildResults', () => {
  test('maps each status to the TestRail status id and keeps only the fields that are set', () => {
    const results: CaseResult[] = [
      { caseId: 'AAA-001', status: 'passed' },
      { caseId: 'AAA-002', status: 'failed', comment: 'Wrong total', elapsed: '1m 5s', defects: 'KIT-3' },
      { caseId: 'BBB-001', status: 'blocked' },
      { caseId: 'BBB-002', status: 'retest' },
    ];
    assert.deepEqual(buildResults(results, map), [
      { case_id: 101, status_id: 1 },
      { case_id: 102, status_id: 5, comment: 'Wrong total', elapsed: '1m 5s', defects: 'KIT-3' },
      { case_id: 103, status_id: 2 },
      { case_id: 104, status_id: 4 },
    ]);
    assert.deepEqual(STATUS_IDS, { passed: 1, blocked: 2, retest: 4, failed: 5 });
  });

  test('refuses a result whose case has no TestRail id', () => {
    assert.throws(() => buildResults([{ caseId: 'ZZZ-009', status: 'passed' }], map), /ZZZ-009 has no TestRail id/);
  });
});

describe('planAddResults', () => {
  test('targets the documented add_results_for_cases path and ignores a trailing slash', () => {
    const request = planAddResults('https://example.testrail.io/', 7, [{ case_id: 101, status_id: 1 }]);
    assert.equal(request.method, 'POST');
    assert.equal(request.url, 'https://example.testrail.io/index.php?/api/v2/add_results_for_cases/7');
    assert.deepEqual(request.body, { results: [{ case_id: 101, status_id: 1 }] });
  });
});

describe('validateMap', () => {
  const messages = (value: unknown) => validateMap(value, makeSuite()).map((i) => i.id + ': ' + i.message);

  test('accepts a complete map', () => assert.deepEqual(messages(map), []));
  test('reports a case with no id', () => assert.deepEqual(messages({ 'AAA-001': 1, 'AAA-002': 2, 'BBB-001': 3 }), ['BBB-002: No TestRail id in the case map']));
  test('reports a non-number and a zero', () => {
    assert.deepEqual(messages({ ...map, 'AAA-001': '101', 'AAA-002': 0 }), [
      'AAA-001: TestRail id must be a positive whole number',
      'AAA-002: TestRail id must be a positive whole number',
    ]);
  });
  test('reports one TestRail id used for two cases', () => {
    assert.deepEqual(messages({ ...map, 'AAA-002': 101 }), ['AAA-002: TestRail id 101 is also used by AAA-001']);
  });
  test('reports an id that is not a case in the suite', () => {
    assert.deepEqual(messages({ ...map, 'ZZZ-001': 999 }), ['ZZZ-001: Not a case in the suite']);
  });
  test('rejects a map that is not an object', () => assert.equal(messages([1, 2]).length, 1));
});

describe('reportResults against the local mock', () => {
  test('stores the results the mock accepted', async () => {
    const server = await start();
    const stored = await reportResults(connection(server.url), 7, [{ caseId: 'AAA-001', status: 'passed' }, { caseId: 'AAA-002', status: 'failed', comment: 'Wrong total' }], map);
    assert.equal(stored.length, 2);
    assert.deepEqual(server.accepted.testrail, [{ results: [{ case_id: 101, status_id: 1 }, { case_id: 102, status_id: 5, comment: 'Wrong total' }] }]);
  });

  test('a wrong API key is a 401 and nothing is stored', async () => {
    const server = await start();
    await assert.rejects(reportResults({ ...connection(server.url), apiKey: 'bad' }, 7, [{ caseId: 'AAA-001', status: 'passed' }], map), /HTTP 401: Authentication failed/);
    assert.equal(server.accepted.testrail.length, 0);
  });

  test('an unknown run is a 400 with TestRail wording', async () => {
    const server = await start();
    await assert.rejects(reportResults(connection(server.url), 99, [{ caseId: 'AAA-001', status: 'passed' }], map), /HTTP 400: Field :run_id is not a valid test run/);
  });

  test('a case that is not in the run is a 400', async () => {
    const server = await start();
    await assert.rejects(reportResults(connection(server.url), 7, [{ caseId: 'BBB-002', status: 'passed' }], map), /HTTP 400: .*not a valid test case for this run: 104/);
  });

  test('the mock refuses an elapsed time TestRail would not read, even when the kit would not send one', async () => {
    const server = await start();
    await assert.rejects(reportResults(connection(server.url), 7, [{ caseId: 'AAA-001', status: 'passed', elapsed: '90 seconds' }], map), /HTTP 400: Field :elapsed has an invalid time span/);
  });

  test('a 429 is retried after the wait and then succeeds', async () => {
    const server = await start(1);
    const waits: number[] = [];
    await reportResults(connection(server.url), 7, [{ caseId: 'AAA-001', status: 'passed' }], map, { sleep: async (ms) => void waits.push(ms) });
    assert.deepEqual(waits, [1000]);
    assert.equal(server.accepted.testrail.length, 1);
  });

  test('gives up after the retries and says so', async () => {
    const server = await start(5);
    await assert.rejects(reportResults(connection(server.url), 7, [{ caseId: 'AAA-001', status: 'passed' }], map, { sleep: noWait }), /HTTP 429/);
  });

  test('an unreachable server names the address but never the key', async () => {
    const error = await reportResults({ baseUrl: 'http://127.0.0.1:1', user: 'qa@example.com', apiKey: 'good-key' }, 7, [{ caseId: 'AAA-001', status: 'passed' }], map).catch((e: Error) => e);
    assert.match((error as Error).message, /Could not reach http:\/\/127\.0\.0\.1:1/);
    assert.doesNotMatch((error as Error).message, /good-key/);
  });
});

describe('an answer that does not come from the API', () => {
  const serve = async (status: number, body: string) => {
    const http = await import('node:http');
    const server = http.createServer((_req, res) => {
      res.writeHead(status, { 'Content-Type': 'text/html' });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    return { url: 'http://127.0.0.1:' + port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  };

  test('a 200 login page is an error, not a success with nothing stored', async () => {
    const page = await serve(200, '<html>Please sign in</html>');
    try {
      await assert.rejects(reportResults(connection(page.url), 7, [{ caseId: 'AAA-001', status: 'passed' }], map), /the answer was not JSON.*check --base-url/);
    } finally {
      await page.close();
    }
  });

  test('fewer stored results than sent is an error that says how many arrived', async () => {
    const short = await serve(200, '[]');
    try {
      await assert.rejects(reportResults(connection(short.url), 7, [{ caseId: 'AAA-001', status: 'passed' }, { caseId: 'AAA-002', status: 'passed' }], map), /stored 0 of 2 result\(s\)/);
    } finally {
      await short.close();
    }
  });
});
