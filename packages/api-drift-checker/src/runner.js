// Runs a scenario (a list of HTTP steps) against an API and checks every response
// against the OpenAPI spec. Steps can save values (ids, tokens) for later steps.

import { checkResponse } from './schema.js';

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, k) => {
  if (!(k in vars)) throw new Error(`Scenario variable "${k}" was never saved`);
  return vars[k];
});

export async function runScenario({ baseUrl, spec, steps, fetchImpl = fetch }) {
  const vars = {};
  const results = [];
  for (const step of steps) {
    const path = fill(step.path, vars);
    const headers = { 'Content-Type': 'application/json' };
    // `auth: true` sends the saved `token`; `auth: 'adminToken'` sends that saved variable.
    if (step.auth) headers.Authorization = `Bearer ${vars[step.auth === true ? 'token' : step.auth]}`;
    const body = typeof step.body === 'function' ? step.body(vars) : step.body;

    const res = await fetchImpl(baseUrl + path, { method: step.method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }

    const issues = checkResponse(spec, { method: step.method, path, status: res.status, body: json });
    if (step.expect !== undefined && res.status !== step.expect) {
      issues.unshift({ kind: 'unexpected-status', path: '$', message: `expected ${step.expect}, got ${res.status}` });
    }
    if (step.save && res.status < 300) Object.assign(vars, step.save(json));
    results.push({ name: step.name, method: step.method, path, status: res.status, issues });
  }
  return results;
}

// Which documented operations the scenario never called.
export function untestedOperations(spec, results) {
  const all = Object.entries(spec.paths).flatMap(([template, ops]) => Object.keys(ops).map((m) => ({ method: m.toUpperCase(), template })));
  return all.filter(({ method, template }) => {
    const re = new RegExp('^' + template.replace(/\{[^}]+\}/g, '[^/]+') + '$');
    return !results.some((r) => r.method === method && re.test(r.path.split('?')[0]));
  });
}

export function formatResults(results, untested) {
  const lines = [];
  for (const r of results) {
    lines.push(`${r.issues.length ? 'DRIFT' : 'pass '} ${r.method.padEnd(6)} ${r.path.padEnd(22)} ${r.status}  ${r.name}`);
    for (const i of r.issues) lines.push(`        ${i.kind}: ${i.path === '$' ? '' : i.path + ' '}${i.message}`);
  }
  const drift = results.filter((r) => r.issues.length).length;
  lines.push('', `${results.length - drift}/${results.length} responses match the spec, ${drift} drifted`);
  lines.push(`Documented operations never called: ${untested.length ? untested.map((u) => `${u.method} ${u.template}`).join(', ') : 'none'}`);
  return lines.join('\n');
}
