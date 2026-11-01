import { basicAuth, requestJson, trimSlash } from './http.ts';
import type { PlannedRequest } from './http.ts';
import type { CaseResult, Status } from './results.ts';
import type { Issue, Suite } from './types.ts';

/** TestRail's default status ids. A project that renamed or added statuses needs its own table. */
export const STATUS_IDS: Record<Status, number> = { passed: 1, blocked: 2, retest: 4, failed: 5 };

/** Our case id (OTC-001) to the numeric id TestRail gave the case after import (C101 is 101). */
export type CaseMap = Record<string, number>;

export interface TestRailResult {
  case_id: number;
  status_id: number;
  comment?: string;
  elapsed?: string;
  defects?: string;
}

export interface TestRailConnection {
  baseUrl: string;
  user: string;
  apiKey: string;
}

/** Checks the map covers the suite and holds only whole numbers, with no id used twice. */
export function validateMap(map: unknown, suite: Suite): Issue[] {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    return [{ id: '(map)', field: 'map', message: 'The case map must be an object of case id to TestRail id' }];
  }
  const issues: Issue[] = [];
  const used = new Map<number, string>();
  const entries = map as Record<string, unknown>;
  for (const testCase of suite.cases) {
    const value = entries[testCase.id];
    if (value === undefined) issues.push({ id: testCase.id, field: 'map', message: 'No TestRail id in the case map' });
    else if (!Number.isInteger(value) || (value as number) <= 0) {
      issues.push({ id: testCase.id, field: 'map', message: 'TestRail id must be a positive whole number' });
    } else if (used.has(value as number)) {
      issues.push({ id: testCase.id, field: 'map', message: 'TestRail id ' + String(value) + ' is also used by ' + used.get(value as number) });
    } else used.set(value as number, testCase.id);
  }
  for (const id of Object.keys(entries)) {
    if (!suite.cases.some((c) => c.id === id)) issues.push({ id, field: 'map', message: 'Not a case in the suite' });
  }
  return issues;
}

export function buildResults(results: CaseResult[], map: CaseMap): TestRailResult[] {
  return results.map((result) => {
    const caseId = map[result.caseId];
    if (caseId === undefined) throw new Error(result.caseId + ' has no TestRail id in the case map');
    const out: TestRailResult = { case_id: caseId, status_id: STATUS_IDS[result.status] };
    if (result.comment) out.comment = result.comment;
    if (result.elapsed) out.elapsed = result.elapsed;
    if (result.defects) out.defects = result.defects;
    return out;
  });
}

/** POST index.php?/api/v2/add_results_for_cases/{run_id}, as in TestRail's API reference. */
export function planAddResults(baseUrl: string, runId: number, results: TestRailResult[]): PlannedRequest {
  return {
    method: 'POST',
    url: trimSlash(baseUrl) + '/index.php?/api/v2/add_results_for_cases/' + runId,
    body: { results },
  };
}

export async function reportResults(
  connection: TestRailConnection,
  runId: number,
  results: CaseResult[],
  map: CaseMap,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<unknown[]> {
  const request = planAddResults(connection.baseUrl, runId, buildResults(results, map));
  const response = await requestJson(request, { Authorization: basicAuth(connection.user, connection.apiKey) }, options);
  // TestRail answers with one stored result per result sent; anything else means they did not all arrive.
  if (!Array.isArray(response) || response.length !== results.length) {
    throw new Error('TestRail stored ' + (Array.isArray(response) ? response.length : 0) + ' of ' + results.length + ' result(s); check the run before sending again');
  }
  return response;
}
