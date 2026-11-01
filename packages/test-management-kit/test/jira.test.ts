import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { blockedDrafts, buildDescription, buildReport, createIssues, JIRA_PRIORITY, PartialFilingError, prepareIssues } from '../src/jira.ts';
import { startMock } from '../src/mock.ts';
import type { MockServer } from '../src/mock.ts';
import type { CaseResult } from '../src/results.ts';
import { makeCase, makeSuite } from './helpers.ts';

const good: CaseResult = {
  caseId: 'AAA-001',
  status: 'failed',
  severity: 'high',
  environment: 'Chrome 130 on Windows 11, build 12',
  steps: ['Open the invoice', 'Apply a payment of 40.00'],
  actual: 'The balance stays at 100.00 after the payment is applied',
  evidence: ['shot.png'],
};
const connection = (baseUrl: string) => ({ baseUrl, email: 'qa@example.com', apiToken: 'good-token' });

let mock: MockServer | undefined;
const start = async (rateLimitFirst = 0) => {
  mock = await startMock({ jira: { email: 'qa@example.com', apiToken: 'good-token', projects: ['KIT'] }, rateLimitFirst });
  return mock;
};
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe('buildReport', () => {
  test('turns a failed result into the shape the defect-report-linter reads', () => {
    const report = buildReport(good, makeCase({ id: 'AAA-001', title: 'Invoice paid in part', expectedResult: 'Balance falls' }), 'First section');
    assert.deepEqual(report, {
      source: 'AAA-001',
      title: 'AAA-001: Invoice paid in part fails',
      severity: 'high',
      environment: 'Chrome 130 on Windows 11, build 12',
      component: 'First section',
      steps: ['Open the invoice', 'Apply a payment of 40.00'],
      expected: 'Balance falls',
      actual: 'The balance stays at 100.00 after the payment is applied',
      evidence: ['shot.png'],
    });
  });

  test('takes severity from the case priority and actual from the comment when the result gives neither', () => {
    const report = buildReport({ caseId: 'AAA-001', status: 'failed', comment: 'Total is wrong' }, makeCase({ priority: 'Critical' }), 'S');
    assert.equal(report.severity, 'critical');
    assert.equal(report.actual, 'Total is wrong');
  });
});

describe('buildDescription', () => {
  test('is an Atlassian document with the sections in order, and References only when the case has some', () => {
    const withRefs = buildDescription(buildReport(good, makeCase(), 'S'), makeCase({ references: ['REQ-12', 'https://example.com/spec'] })) as { type: string; content: Array<{ type: string; content: Array<{ text?: string }> }> };
    assert.equal(withRefs.type, 'doc');
    const headings = withRefs.content.filter((n) => n.type === 'heading').map((n) => n.content[0]?.text);
    assert.deepEqual(headings, ['Steps to reproduce', 'Expected result', 'Actual result', 'Environment', 'Evidence', 'References']);
    const withoutRefs = buildDescription(buildReport(good, makeCase(), 'S'), makeCase()) as typeof withRefs;
    assert.ok(!withoutRefs.content.some((n) => n.content[0]?.text === 'References'));
  });
});

describe('prepareIssues', () => {
  const prepare = (results: CaseResult[]) => prepareIssues(results, makeSuite(), 'KIT', 'https://example.atlassian.net');

  test('drafts only the failed results', () => {
    const { drafts } = prepare([{ caseId: 'AAA-002', status: 'passed' }, good, { caseId: 'BBB-001', status: 'blocked' }]);
    assert.deepEqual(drafts.map((d) => d.caseId), ['AAA-001']);
    assert.equal(drafts[0]?.request.url, 'https://example.atlassian.net/rest/api/3/issue');
  });

  test('a complete failure is Ready, with the priority mapped to Jira wording', () => {
    const draft = prepare([good]).drafts[0];
    assert.equal(draft?.lint.status, 'Ready');
    const fields = (draft?.request.body as { fields: { priority: { name: string }; project: { key: string }; issuetype: { name: string } } }).fields;
    assert.deepEqual([fields.priority.name, fields.project.key, fields.issuetype.name], ['High', 'KIT', 'Bug']);
    assert.deepEqual(JIRA_PRIORITY, { critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low' });
  });

  test('a failure with no steps and no actual result is blocked by the linter', () => {
    const { drafts } = prepare([{ caseId: 'AAA-001', status: 'failed', severity: 'high' }]);
    assert.equal(blockedDrafts(drafts).length, 1);
    const rules = drafts[0]?.lint.findings.map((f) => f.rule);
    assert.ok(rules?.includes('steps-missing') && rules.includes('actual-missing'));
  });

  test('a serious failure with no evidence only draws a warning, so it is not blocked', () => {
    const { drafts } = prepare([{ ...good, evidence: undefined }]);
    assert.equal(blockedDrafts(drafts).length, 0);
    assert.ok(drafts[0]?.lint.findings.some((f) => f.rule === 'evidence-missing'));
  });

  test('a severity the linter does not know is blocked', () => {
    assert.equal(blockedDrafts(prepare([{ ...good, severity: 'urgent' }]).drafts).length, 1);
  });

  test('a failure that already has an issue key is left alone', () => {
    const result = prepare([{ ...good, defects: 'KIT-9' }]);
    assert.deepEqual(result.alreadyFiled, ['AAA-001']);
    assert.equal(result.drafts.length, 0);
  });
});

describe('createIssues against the local mock', () => {
  const drafts = (...results: CaseResult[]) => prepareIssues(results, makeSuite(), 'KIT', 'x').drafts;
  const retarget = (list: ReturnType<typeof drafts>, url: string) => list.map((d) => ({ ...d, request: { ...d.request, url: url + '/rest/api/3/issue' } }));

  test('files each failure and returns its key', async () => {
    const server = await start();
    const keys = await createIssues(connection(server.url), retarget(drafts(good, { ...good, caseId: 'AAA-002' }), server.url));
    assert.deepEqual(keys, { 'AAA-001': 'KIT-1', 'AAA-002': 'KIT-2' });
    assert.equal(server.accepted.jira.length, 2);
  });

  test('the mock refuses a plain-text description, which is why the kit sends a document', async () => {
    const server = await start();
    const [draft] = retarget(drafts(good), server.url);
    assert.ok(draft);
    const plain = { ...draft, request: { ...draft.request, body: { fields: { ...(draft.request.body as { fields: object }).fields, description: 'plain text' } } } };
    await assert.rejects(createIssues(connection(server.url), [plain]), /description: Operation value must be an Atlassian Document/);
  });

  test('a wrong token is a 401', async () => {
    const server = await start();
    await assert.rejects(createIssues({ ...connection(server.url), apiToken: 'bad' }, retarget(drafts(good), server.url)), /HTTP 401/);
  });

  test('an unknown project is a 400 naming the field', async () => {
    const server = await start();
    const bad = prepareIssues([good], makeSuite(), 'NOPE', server.url).drafts;
    await assert.rejects(createIssues(connection(server.url), bad), /HTTP 400: project: valid project is required/);
  });

  test('stopping part way reports the keys already filed', async () => {
    const server = await start();
    const list = retarget(drafts(good, { ...good, caseId: 'AAA-002' }), server.url);
    const second = list[1];
    assert.ok(second);
    list[1] = { ...second, request: { ...second.request, body: { fields: { project: { key: 'NOPE' } } } } };
    const error = await createIssues(connection(server.url), list).catch((e: unknown) => e);
    assert.ok(error instanceof PartialFilingError);
    assert.deepEqual(error.created, { 'AAA-001': 'KIT-1' });
    assert.match(error.message, /Stopped at AAA-002 after 1 issue\(s\) filed/);
  });

  test('a 429 is retried and the issue is filed once', async () => {
    const server = await start(1);
    const keys = await createIssues(connection(server.url), retarget(drafts(good), server.url), { sleep: async () => {} });
    assert.deepEqual(keys, { 'AAA-001': 'KIT-1' });
    assert.equal(server.accepted.jira.length, 1);
  });
});

describe('what Jira refuses, checked by the mock', () => {
  const file = (overrides: Record<string, unknown>, url: string) => {
    const [draft] = prepareIssues([good], makeSuite(), 'KIT', url).drafts;
    assert.ok(draft);
    const fields = (draft.request.body as { fields: Record<string, unknown> }).fields;
    return { ...draft, request: { ...draft.request, body: { fields: { ...fields, ...overrides } } } };
  };

  test('the description carries version 1 on the document itself, as Atlassian Document Format requires', () => {
    const description = buildDescription(buildReport(good, makeCase(), 'S'), makeCase()) as unknown as { version?: number; attrs?: unknown };
    assert.equal(description.version, 1);
    assert.equal(description.attrs, undefined);
  });

  test('a document without its version is refused', async () => {
    const server = await start();
    const noVersion = file({ description: { type: 'doc', content: [] } }, server.url);
    await assert.rejects(createIssues(connection(server.url), [noVersion]), /description: Operation value must be an Atlassian Document/);
  });

  test('blank steps and evidence are dropped so no empty text node is sent', async () => {
    const server = await start();
    const report = buildReport({ ...good, steps: ['Open the invoice', '  ', ''], evidence: ['', 'shot.png'] }, makeCase(), 'S');
    assert.deepEqual(report.steps, ['Open the invoice']);
    assert.deepEqual(report.evidence, ['shot.png']);
    const keys = await createIssues(connection(server.url), prepareIssues([{ ...good, steps: ['Open the invoice', ' ', 'Apply a payment'], evidence: ['', 'a.png'] }], makeSuite(), 'KIT', server.url).drafts);
    assert.deepEqual(keys, { 'AAA-001': 'KIT-1' });
  });

  test('the mock refuses an empty text node, which is what the dropped blanks would have been', async () => {
    const server = await start();
    const empty = file({ description: { version: 1, type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] } }, server.url);
    await assert.rejects(createIssues(connection(server.url), [empty]), /text cannot be empty/);
  });

  test('a long case title is cut to Jira\'s 255 characters, and the mock refuses one that is not', async () => {
    const server = await start();
    const longCase = makeCase({ title: 'x'.repeat(400) });
    const report = buildReport(good, longCase, 'S');
    assert.equal(report.title.length, 255);
    assert.ok(report.title.endsWith('...'));
    const tooLong = file({ summary: 'y'.repeat(256) }, server.url);
    await assert.rejects(createIssues(connection(server.url), [tooLong]), /summary: Summary must be less than 255 characters/);
  });
});
