// The traces report published with the other test reports: one row per AI test,
// anchored by its trace ID (index.html#<trace id>), showing what Langfuse stored for
// it. Built from Langfuse's copy (src/traces.ts reads it back), not from this
// package's own data, so the page shows what the tracing actually captured.
import { sha256 } from './render.ts';
import { spanIdFor, type Observation } from './trace.ts';
import type { Expected } from './traces.ts';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const text = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

const STYLE = `
:root { --bg: #fbfbfa; --fg: #1d1d1b; --muted: #66645e; --line: #e2e0da; --card: #ffffff; --ok: #1f7a45; --bad: #b3261e; --code: #f3f2ee; }
@media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecebe6; --muted: #a3a19a; --line: #34332f; --card: #1f1f1d; --ok: #6cc28f; --bad: #f2867d; --code: #262624; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 1.5rem; margin: 0 0 4px; } h2 { font-size: 1.15rem; margin: 32px 0 8px; } h3 { font-size: 1rem; margin: 20px 0 6px; }
p { margin: 6px 0; } .muted { color: var(--muted); }
.stats { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; min-width: 140px; }
.stat b { display: block; font-size: 1.3rem; }
.wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; background: var(--card); border: 1px solid var(--line); font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
tr:target { outline: 2px solid var(--fg); outline-offset: -2px; }
code { font: 12px ui-monospace, Consolas, monospace; background: var(--code); padding: 1px 4px; border-radius: 4px; word-break: break-all; }
details pre { white-space: pre-wrap; word-break: break-word; font: 12px ui-monospace, Consolas, monospace; background: var(--code); padding: 8px; border-radius: 6px; margin: 4px 0 0; max-width: 520px; }
.ok { color: var(--ok); } .bad { color: var(--bad); font-weight: 600; }
a { color: inherit; }
`;

export function renderTracesPage(
  expected: Expected[],
  observations: Observation[],
  info: { langfuseVersion: string; commit: string; problems: string[] },
): string {
  const byTrace = new Map<string, Observation[]>();
  for (const o of observations) byTrace.set(o.traceId, [...(byTrace.get(o.traceId) ?? []), o]);
  const traced = expected.filter((e) => byTrace.has(e.traceId)).length;
  const passed = expected.filter((e) => e.pass).length;

  const row = (e: Expected): string => {
    const obs = byTrace.get(e.traceId) ?? [];
    const gen = obs.find((o) => o.id === spanIdFor(e.traceId, 'generation'));
    const ev = obs.find((o) => o.id === spanIdFor(e.traceId, 'evaluator'));
    const mismatch = info.problems.filter((p) => p.includes(e.traceId));
    let result = '<span class="bad">no result traced</span>';
    if (ev) {
      try {
        const r = JSON.parse(text(ev.output)) as { pass: boolean; reason: string };
        result = `<span class="${r.pass ? 'ok' : 'bad'}">${r.pass ? 'pass' : 'fail'}</span>${r.pass ? '' : `<details><summary>why</summary><pre>${esc(r.reason)}</pre></details>`}`;
      } catch { result = '<span class="bad">unreadable result</span>'; }
    }
    const promptSha = gen ? sha256(text(gen.input)) : null;
    return `<tr id="${e.traceId}">
<td>${esc(e.caseId)}</td>
<td><a href="#${e.traceId}"><code>${e.traceId}</code></a></td>
<td>${result}</td>
<td>${gen ? `<details><summary>reply</summary><pre>${esc(text(gen.output))}</pre></details>` : '<span class="bad">no generation</span>'}</td>
<td>${promptSha ? `<a href="prompts/${promptSha}.txt"><code>${promptSha.slice(0, 12)}</code></a>` : '—'}</td>
<td>${esc(gen?.model ?? '—')}</td>
<td>${mismatch.length ? `<span class="bad">${esc(mismatch.map((m) => m.split(': ').slice(1).join(': ')).join('; '))}</span>` : '<span class="ok">matches</span>'}</td>
</tr>`;
  };

  const sections = (['day40', 'redteam'] as const).map((suite) => {
    const runs = [...new Set(expected.filter((e) => e.suite === suite).map((e) => e.run))];
    if (!runs.length) return '';
    const title = suite === 'day40' ? 'Day 40: judge vs human labels' : 'Day 41: red team';
    return `<h2>${title}</h2>${runs.map((run) => `
<h3>Session <code>${esc(run)}</code></h3>
<div class="wrap"><table>
<thead><tr><th>Case</th><th>Trace ID</th><th>promptfoo</th><th>Reply as traced</th><th>Prompt</th><th>Model</th><th>Trace vs test</th></tr></thead>
<tbody>${expected.filter((e) => e.suite === suite && e.run === run).map(row).join('')}</tbody>
</table></div>`).join('')}`;
  }).join('');

  const other = info.problems.filter((p) => !expected.some((e) => p.includes(e.traceId)));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>LLM Judge Traces</title><style>${STYLE}</style></head>
<body><main>
<h1>LLM judge traces</h1>
<p class="muted">Every AI test in <a href="https://github.com/rizvihiqrar/qa-automation-platform/tree/main/packages/llm-judge-check">llm-judge-check</a>, linked to its trace in a self-hosted Langfuse ${esc(info.langfuseVersion)}, as Langfuse stored it. Commit <code>${esc(info.commit.slice(0, 12))}</code>.</p>
<p class="muted">The judge calls are recorded runs replayed through promptfoo, so no model was called: timings are the replay's, and there is no token usage. A trace ID is derived from the suite, the session, the case and the prompt's SHA-256, so the same test has the same trace ID in every run and on any Langfuse loaded with <code>npm run traces</code>. Link to a test with <code>#&lt;trace id&gt;</code>.</p>
<div class="stats">
<div class="stat"><b>${expected.length}</b>AI tests</div>
<div class="stat"><b>${traced}</b>with a trace</div>
<div class="stat"><b>${observations.length}</b>observations</div>
<div class="stat"><b>${passed}</b>passed in promptfoo</div>
<div class="stat"><b class="${info.problems.length ? 'bad' : 'ok'}">${info.problems.length}</b>problems</div>
</div>
<p class="muted">A failed promptfoo test is a judge disagreeing with the label (Day 40) or a red-team case scored as failed (Day 41): those are results, not tracing problems. "Trace vs test" says whether Langfuse holds exactly what the test saw.</p>
${other.length ? `<h2>Problems</h2><ul>${other.map((p) => `<li class="bad">${esc(p)}</li>`).join('')}</ul>` : ''}
${sections}
</main></body></html>
`;
}
