import { basicAuth, requestJson, trimSlash } from './http.ts';
import type { PlannedRequest } from './http.ts';
import { lint } from './linter.ts';
import type { DefectReport, LintResult } from './linter.ts';
import type { CaseResult } from './results.ts';
import type { Suite, TestCase } from './types.ts';

export interface JiraConnection {
  baseUrl: string;
  email: string;
  apiToken: string;
}

/** Jira's priority names, keyed by the severity words the linter accepts. */
export const JIRA_PRIORITY: Record<string, string> = { critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low' };

// Atlassian Document Format, the only description format the v3 issue endpoint accepts.
type AdfNode = { version?: number; type: string; attrs?: Record<string, unknown>; content?: AdfNode[]; text?: string };
const text = (value: string): AdfNode => ({ type: 'text', text: value });
const paragraph = (value: string): AdfNode => ({ type: 'paragraph', content: [text(value)] });
const heading = (value: string): AdfNode => ({ type: 'heading', attrs: { level: 3 }, content: [text(value)] });
const list = (type: 'bulletList' | 'orderedList', items: string[]): AdfNode => ({
  type,
  content: items.map((item) => ({ type: 'listItem', content: [paragraph(item)] })),
});

export interface IssueDraft {
  caseId: string;
  report: DefectReport;
  lint: LintResult;
  request: PlannedRequest;
}

/** Jira refuses a summary over 255 characters. */
export const MAX_SUMMARY = 255;

// Jira refuses an empty text node, so blank list items are dropped before they reach the report.
const nonBlank = (items: string[] | undefined): string[] => (items ?? []).map((item) => item.trim()).filter(Boolean);

/** A failed result, as the normalized shape the defect-report-linter reads. */
export function buildReport(result: CaseResult, testCase: TestCase, sectionName: string): DefectReport {
  const title = testCase.id + ': ' + testCase.title + ' fails';
  return {
    source: result.caseId,
    title: title.length > MAX_SUMMARY ? title.slice(0, MAX_SUMMARY - 3) + '...' : title,
    severity: (result.severity ?? testCase.priority).toLowerCase(),
    environment: (result.environment ?? '').trim(),
    component: sectionName,
    steps: nonBlank(result.steps),
    expected: testCase.expectedResult,
    actual: (result.actual ?? result.comment ?? '').trim(),
    evidence: nonBlank(result.evidence),
  };
}

export function buildDescription(report: DefectReport, testCase: TestCase): AdfNode {
  const content: AdfNode[] = [
    paragraph('Raised from test case ' + testCase.id + ' (' + report.component + ').'),
    heading('Steps to reproduce'),
    list('orderedList', report.steps.length ? report.steps : [testCase.description]),
    heading('Expected result'),
    paragraph(report.expected),
    heading('Actual result'),
    paragraph(report.actual),
  ];
  if (report.environment) content.push(heading('Environment'), paragraph(report.environment));
  if (report.evidence.length) content.push(heading('Evidence'), list('bulletList', report.evidence));
  const references = nonBlank(testCase.references);
  if (references.length) content.push(heading('References'), list('bulletList', references));
  return { version: 1, type: 'doc', content };
}

/** POST /rest/api/3/issue, as in Atlassian's REST API reference. */
export function planIssue(baseUrl: string, projectKey: string, report: DefectReport, testCase: TestCase, labels: string[]): PlannedRequest {
  return {
    method: 'POST',
    url: trimSlash(baseUrl) + '/rest/api/3/issue',
    body: {
      fields: {
        project: { key: projectKey },
        issuetype: { name: 'Bug' },
        summary: report.title,
        description: buildDescription(report, testCase),
        priority: { name: JIRA_PRIORITY[report.severity] ?? 'Medium' },
        labels,
      },
    },
  };
}

export interface Preparation {
  drafts: IssueDraft[];
  /** Failed cases that already carry an issue key, left alone so a re-run cannot file duplicates. */
  alreadyFiled: string[];
}

/** Lints every failed result and builds its request. Nothing is sent. */
export function prepareIssues(results: CaseResult[], suite: Suite, projectKey: string, baseUrl: string, labels: string[] = ['test-management-kit']): Preparation {
  const drafts: IssueDraft[] = [];
  const alreadyFiled: string[] = [];
  for (const result of results) {
    if (result.status !== 'failed') continue;
    if (result.defects) {
      alreadyFiled.push(result.caseId);
      continue;
    }
    const testCase = suite.cases.find((c) => c.id === result.caseId);
    if (!testCase) throw new Error(result.caseId + ' is not a case in the suite');
    const sectionName = suite.sections.find((s) => s.id === testCase.section)?.name ?? testCase.section;
    const report = buildReport(result, testCase, sectionName);
    drafts.push({ caseId: result.caseId, report, lint: lint(report), request: planIssue(baseUrl, projectKey, report, testCase, labels) });
  }
  return { drafts, alreadyFiled };
}

/** Drafts the linter calls Not ready. Filing is all or nothing, so one of these stops the run. */
export const blockedDrafts = (drafts: IssueDraft[]): IssueDraft[] => drafts.filter((d) => d.lint.errors > 0);

/** Thrown when filing stops part way. `created` holds the keys already filed so the caller can save them. */
export class PartialFilingError extends Error {
  created: Record<string, string>;
  constructor(message: string, created: Record<string, string>) {
    super(message);
    this.name = 'PartialFilingError';
    this.created = created;
  }
}

/** Files each draft and returns case id to issue key. Call only after blockedDrafts is empty. */
export async function createIssues(
  connection: JiraConnection,
  drafts: IssueDraft[],
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};
  const headers = { Authorization: basicAuth(connection.email, connection.apiToken) };
  for (const draft of drafts) {
    try {
      const response = (await requestJson(draft.request, headers, options)) as { key?: unknown } | null;
      if (typeof response?.key !== 'string') throw new Error('Jira answered without an issue key');
      keys[draft.caseId] = response.key;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new PartialFilingError('Stopped at ' + draft.caseId + ' after ' + Object.keys(keys).length + ' issue(s) filed: ' + reason, keys);
    }
  }
  return keys;
}
