// Picks workflow runs out of an unfiltered list. The scripts must not ask GitHub to filter
// the list (?branch=, &status=, &created=): during the incident of 2026-10-22 (errors
// loading search results) those filters returned empty lists, and the daily health check
// reported a workflow with a green run as "overdue: no finished run on main".
// scripts/workflow-run-list.test.mjs keeps the filters from coming back.

// Runs on main, in the order GitHub returned them (newest first).
export function onMain(runs) {
  return runs.filter((r) => r.head_branch === 'main');
}

// The newest successful run on main that started before `createdAt`.
export function lastGreenBefore(runs, createdAt) {
  return onMain(runs).find((r) => r.status === 'completed' && r.conclusion === 'success' && Date.parse(r.created_at) < Date.parse(createdAt));
}
