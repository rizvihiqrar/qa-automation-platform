import type { Issue, Suite } from './types.ts';

/** Statuses a run can report. TestRail's default ids are mapped in testrail.ts. */
export const STATUSES = ['passed', 'blocked', 'retest', 'failed'] as const;
export type Status = (typeof STATUSES)[number];

export interface CaseResult {
  caseId: string;
  status: Status;
  comment?: string;
  /** TestRail time format, for example "30s" or "1m 45s". */
  elapsed?: string;
  /** Issue key written back after the Jira step, for example "KIT-12". */
  defects?: string;
  // The fields below describe a failure and feed the defect report.
  severity?: string;
  environment?: string;
  steps?: string[];
  actual?: string;
  evidence?: string[];
}

export interface ResultsFile {
  runId?: number;
  results: CaseResult[];
}

export const ELAPSED_FORMAT = /^\d+[hms](\s\d+[hms])*$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const OPTIONAL_STRINGS = ['comment', 'elapsed', 'defects', 'severity', 'environment', 'actual'] as const;
const OPTIONAL_LISTS = ['steps', 'evidence'] as const;

/** Checks a results file against the suite. Returns every problem, never throws on bad shape. */
export function validateResults(file: unknown, suite: Suite): Issue[] {
  const issues: Issue[] = [];
  if (!isObject(file) || !Array.isArray(file.results)) {
    return [{ id: '(file)', field: 'results', message: 'The results file needs a "results" list' }];
  }
  if (file.runId !== undefined && !(Number.isInteger(file.runId) && (file.runId as number) > 0)) {
    issues.push({ id: '(file)', field: 'runId', message: 'runId must be a positive whole number' });
  }
  if (file.results.length === 0) issues.push({ id: '(file)', field: 'results', message: 'The results list is empty' });

  const known = new Set(suite.cases.map((c) => c.id));
  const seen = new Set<string>();
  file.results.forEach((entry: unknown, index: number) => {
    const id = isObject(entry) && typeof entry.caseId === 'string' && entry.caseId ? entry.caseId : '(result ' + (index + 1) + ')';
    const problem = (field: string, message: string) => issues.push({ id, field, message });
    if (!isObject(entry)) return problem('result', 'Each result must be an object');

    if (typeof entry.caseId !== 'string' || !entry.caseId) problem('caseId', 'Missing caseId');
    else if (!known.has(entry.caseId)) problem('caseId', 'No such case in the suite');
    else if (seen.has(entry.caseId)) problem('caseId', 'Reported twice');
    else seen.add(entry.caseId);

    if (!(STATUSES as readonly unknown[]).includes(entry.status)) {
      problem('status', 'Status must be one of ' + STATUSES.join(', '));
    }
    for (const field of OPTIONAL_STRINGS) {
      if (entry[field] !== undefined && typeof entry[field] !== 'string') problem(field, field + ' must be text');
    }
    for (const field of OPTIONAL_LISTS) {
      const value = entry[field];
      if (value !== undefined && !(Array.isArray(value) && value.every((v) => typeof v === 'string'))) {
        problem(field, field + ' must be a list of text');
      }
    }
    if (typeof entry.elapsed === 'string' && !ELAPSED_FORMAT.test(entry.elapsed)) {
      problem('elapsed', 'Use the form 30s or 1m 45s');
    }
  });
  return issues;
}
