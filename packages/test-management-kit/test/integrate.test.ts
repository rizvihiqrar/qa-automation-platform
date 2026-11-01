import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';
import { checkBaseUrl, parseIntegrationArgs, runIntegration } from '../src/integrate.ts';
import { startMock } from '../src/mock.ts';
import type { MockServer } from '../src/mock.ts';

const examples = (name: string) => new URL('../examples/' + name, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const RESULTS = examples('run-results.json');
const WEAK = examples('run-results-weak.json');
const MAP = examples('testrail-map.json');
const TR = { TESTRAIL_USER: 'qa@example.com', TESTRAIL_API_KEY: 'good-key' };
const JIRA = { JIRA_EMAIL: 'qa@example.com', JIRA_API_TOKEN: 'good-token' };
const noWait = async () => {};

let mock: MockServer | undefined;
let tmp: string | undefined;
const start = async () => {
  mock = await startMock({
    testrail: { user: 'qa@example.com', apiKey: 'good-key', runs: { 1: Array.from({ length: 52 }, (_, i) => 101 + i) } },
    jira: { email: 'qa@example.com', apiToken: 'good-token', projects: ['KIT'] },
  });
  return mock;
};
afterEach(async () => {
  await mock?.close();
  mock = undefined;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});
const tempFile = (name: string) => path.join((tmp ??= fs.mkdtempSync(path.join(os.tmpdir(), 'tmk-'))), name);

describe('checkBaseUrl', () => {
  test('allows https anywhere and http only on this machine', () => {
    assert.equal(checkBaseUrl('https://example.testrail.io'), 'https://example.testrail.io');
    assert.equal(checkBaseUrl('http://localhost:3000'), 'http://localhost:3000');
    assert.equal(checkBaseUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
  });
  test('refuses plain http to another host, because the credentials would travel in the clear', () => {
    assert.throws(() => checkBaseUrl('http://example.testrail.io'), /must use https/);
  });
  test('refuses a missing or invalid address', () => {
    assert.throws(() => checkBaseUrl(null), /--base-url is required/);
    assert.throws(() => checkBaseUrl('not a url'), /not a valid address/);
  });
});

describe('parseIntegrationArgs', () => {
  test('reads every option', () => {
    const o = parseIntegrationArgs(['create-jira', '--results', 'r.json', '--project', 'KIT', '--base-url', 'https://x', '--out', 'o.json', '--dry-run']);
    assert.deepEqual([o.results, o.project, o.baseUrl, o.out, o.dryRun], ['r.json', 'KIT', 'https://x', 'o.json', true]);
    const t = parseIntegrationArgs(['report-testrail', '--results', 'r.json', '--map', 'm.json', '--run-id', '3']);
    assert.deepEqual([t.map, t.runId], ['m.json', 3]);
  });
  test('rejects unknown options, a missing value and a missing results file', () => {
    assert.throws(() => parseIntegrationArgs(['create-jira', '--results', 'r', '--token', 'abc']), /Unknown option "--token"/);
    assert.throws(() => parseIntegrationArgs(['create-jira', '--results']), /--results needs a value/);
    assert.throws(() => parseIntegrationArgs(['create-jira']), /--results is required/);
    assert.throws(() => parseIntegrationArgs(['report-testrail', '--results', 'r', '--run-id', '0']), /positive whole number/);
  });
});

describe('options that do not apply', () => {
  test('are refused, so nobody thinks --out wrote a file when it did not', () => {
    const base = ['--results', 'r.json', '--base-url', 'https://x'];
    assert.throws(() => parseIntegrationArgs(['report-testrail', ...base, '--out', 'o.json']), /--out does not apply to report-testrail/);
    assert.throws(() => parseIntegrationArgs(['report-testrail', ...base, '--project', 'KIT']), /--project does not apply to report-testrail/);
    assert.throws(() => parseIntegrationArgs(['create-jira', ...base, '--map', 'm.json']), /--map does not apply to create-jira/);
    assert.throws(() => parseIntegrationArgs(['create-jira', ...base, '--run-id', '3']), /--run-id does not apply to create-jira/);
  });
});

describe('report-testrail', () => {
  const args = (url: string, ...more: string[]) => ['report-testrail', '--results', RESULTS, '--map', MAP, '--base-url', url, ...more];

  test('reports a run to the mock', async () => {
    const server = await start();
    const result = await runIntegration(args(server.url), TR, noWait);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Reported 5 result\(s\) to run 1 \(5 stored\)/);
    assert.equal(server.accepted.testrail.length, 1);
  });

  test('a dry run prints the request with the secret hidden and sends nothing', async () => {
    const server = await start();
    const result = await runIntegration(args(server.url, '--dry-run'), TR, noWait);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /POST .*add_results_for_cases\/1/);
    assert.match(result.stdout, /Authorization: Basic \*\*\*/);
    assert.doesNotMatch(result.stdout, /good-key/);
    assert.equal(server.accepted.testrail.length, 0);
  });

  test('asks for the credentials by name and never prints them', async () => {
    const server = await start();
    await assert.rejects(runIntegration(args(server.url), { TESTRAIL_USER: 'qa@example.com' }, noWait), /Set the TESTRAIL_API_KEY environment variable/);
  });

  test('a rejected key surfaces the 401 and the key is not in the message', async () => {
    const server = await start();
    const error = await runIntegration(args(server.url), { ...TR, TESTRAIL_API_KEY: 'wrong-key' }, noWait).catch((e: Error) => e);
    assert.match((error as Error).message, /HTTP 401/);
    assert.doesNotMatch((error as Error).message, /wrong-key/);
  });

  test('refuses without a case map, or with a run that is not given anywhere', async () => {
    const server = await start();
    assert.match((await runIntegration(['report-testrail', '--results', RESULTS, '--base-url', server.url], TR, noWait)).stderr, /--map is required/);
    const noRun = tempFile('no-run.json');
    fs.writeFileSync(noRun, JSON.stringify({ results: [{ caseId: 'OTC-001', status: 'passed' }] }));
    const result = await runIntegration(['report-testrail', '--results', noRun, '--map', MAP, '--base-url', server.url], TR, noWait);
    assert.match(result.stderr, /Give the run with --run-id/);
  });

  test('refuses a results file that names a case the suite does not have', async () => {
    const server = await start();
    const bad = tempFile('bad.json');
    fs.writeFileSync(bad, JSON.stringify({ runId: 1, results: [{ caseId: 'NOPE-1', status: 'passed' }] }));
    const result = await runIntegration(['report-testrail', '--results', bad, '--map', MAP, '--base-url', server.url], TR, noWait);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /NOPE-1: caseId: No such case in the suite/);
    assert.equal(server.accepted.testrail.length, 0);
  });
});

describe('create-jira', () => {
  const args = (url: string, ...more: string[]) => ['create-jira', '--results', RESULTS, '--project', 'KIT', '--base-url', url, ...more];

  test('files the failures, writes the keys back, and a second run files nothing new', async () => {
    const server = await start();
    const out = tempFile('with-keys.json');
    const first = await runIntegration(args(server.url, '--out', out), JIRA, noWait);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /Filed 2 issue\(s\)/);
    assert.match(first.stdout, /OTC-002 -> KIT-1/);
    const saved = JSON.parse(fs.readFileSync(out, 'utf8')) as { results: Array<{ caseId: string; defects?: string }> };
    assert.deepEqual(saved.results.filter((r) => r.defects).map((r) => [r.caseId, r.defects]), [['OTC-002', 'KIT-1'], ['OTC-005', 'KIT-2']]);

    const second = await runIntegration(['create-jira', '--results', out, '--project', 'KIT', '--base-url', server.url], JIRA, noWait);
    assert.match(second.stdout, /Already filed, skipped: OTC-002, OTC-005/);
    assert.match(second.stdout, /Filed 0 issue\(s\)/);
    assert.equal(server.accepted.jira.length, 2);
  });

  test('the keys feed the TestRail defects field', async () => {
    const server = await start();
    const out = tempFile('with-keys.json');
    await runIntegration(args(server.url, '--out', out), JIRA, noWait);
    const report = await runIntegration(['report-testrail', '--results', out, '--map', MAP, '--base-url', server.url], TR, noWait);
    assert.equal(report.code, 0, report.stderr);
    const sent = server.accepted.testrail[0] as { results: Array<{ case_id: number; defects?: string }> };
    assert.deepEqual(sent.results.filter((r) => r.defects).map((r) => [r.case_id, r.defects]), [[102, 'KIT-1'], [105, 'KIT-2']]);
  });

  test('a weak failure report files nothing and says why', async () => {
    const server = await start();
    const result = await runIntegration(['create-jira', '--results', WEAK, '--project', 'KIT', '--base-url', server.url], JIRA, noWait);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Not filing anything: 1 failed case\(s\)/);
    assert.match(result.stderr, /OTC-002: No steps to reproduce/);
    assert.equal(server.accepted.jira.length, 0);
  });

  test('a dry run prints the issues, warns about missing evidence, and sends nothing', async () => {
    const server = await start();
    const result = await runIntegration(args(server.url, '--dry-run'), {}, noWait);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Dry run, nothing sent: 2 issue\(s\)/);
    assert.match(result.stdout, /Authorization: Basic \*\*\*/);
    assert.equal(server.accepted.jira.length, 0);
  });

  test('stopping part way still saves the keys already filed', async () => {
    mock = await startMock({ jira: { email: 'qa@example.com', apiToken: 'good-token', projects: ['KIT'] } });
    const out = tempFile('partial.json');
    const cases = tempFile('two-fail.json');
    // An unknown project makes the mock refuse the first request, so nothing is filed but the file is still written.
    fs.writeFileSync(cases, fs.readFileSync(RESULTS));
    const first = await runIntegration(['create-jira', '--results', cases, '--project', 'NOPE', '--base-url', mock.url, '--out', out], JIRA, noWait);
    assert.equal(first.code, 1);
    assert.match(first.stderr, /Stopped at OTC-002 after 0 issue\(s\) filed/);
    assert.match(first.stderr, /saved in/);
    assert.ok(fs.existsSync(out));
  });

  test('an --out file that cannot be written still prints the keys of the issues that were filed', async () => {
    const server = await start();
    const blocker = tempFile('a-file');
    fs.writeFileSync(blocker, 'not a folder');
    const result = await runIntegration(args(server.url, '--out', path.join(blocker, 'keys.json')), JIRA, noWait);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Could not write .*keys.json/);
    assert.match(result.stderr, /OTC-002 -> KIT-1/);
    assert.match(result.stderr, /OTC-005 -> KIT-2/);
    assert.match(result.stderr, /re-run files duplicates/);
    assert.equal(server.accepted.jira.length, 2);
  });

  test('needs a valid project key', async () => {
    const server = await start();
    assert.match((await runIntegration(['create-jira', '--results', RESULTS, '--base-url', server.url], JIRA, noWait)).stderr, /--project is required/);
    assert.match((await runIntegration(['create-jira', '--results', RESULTS, '--project', 'kit one', '--base-url', server.url], JIRA, noWait)).stderr, /must be a Jira project key/);
  });
});
