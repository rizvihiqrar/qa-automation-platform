// qa-practice-api sampling comparison (A434): the Collector config is what the tests measure,
// so a quiet edit to it would change the result the README quotes. These checks fail on the
// edits the tests in tests/sampling could miss, and on a CI row or image tag that drifts away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const ci = read('.github', 'workflows', 'ci.yml');
const config = read('packages', 'qa-practice-api', 'collector', 'sampling.yaml');

// The text of one pipeline, e.g. traces/tail, from its name to the next pipeline.
function pipeline(name) {
  const body = config.split(/^  pipelines:/m)[1];
  const part = body.split(new RegExp(`^    ${name.replace('/', '\\/')}:`, 'm'))[1];
  assert.ok(part, `no ${name} pipeline in sampling.yaml`);
  return part.split(/^    [\w/]+:/m)[0];
}

test('the sampling job runs npm run test:sampling in a Collector job', () => {
  const row = ci.split(/\r?\n/).find((l) => l.includes('name: qa-practice-api-sampling'));
  assert.ok(row, 'no qa-practice-api-sampling row in ci.yml');
  assert.match(row, /collector: true/);
  assert.match(row, /command: npm run test:sampling/);
});

test('with-sampling.ts starts the same Collector image the other jobs pull', () => {
  const tag = (file) => read('packages', 'qa-practice-api', 'scripts', file).match(/COLLECTOR_IMAGE = '([^']+)'/)?.[1];
  assert.ok(tag('with-sampling.ts'), 'COLLECTOR_IMAGE not found in with-sampling.ts');
  assert.equal(tag('with-sampling.ts'), tag('with-collector.ts'));
  const pulled = [...ci.matchAll(/docker pull --quiet (\S+)/g)].map((m) => m[1]);
  assert.ok(pulled.includes(tag('with-sampling.ts')), 'ci.yml does not pull the sampling Collector image');
});

test('the three pipelines keep their roles: all keeps everything, head samples by trace id, tail looks at the whole trace', () => {
  assert.doesNotMatch(pipeline('traces/all'), /sampler|sampling/, 'the control pipeline must not sample');
  assert.match(pipeline('traces/head'), /processors: \[[^\]]*probabilistic_sampler\/head/);
  assert.match(pipeline('traces/tail'), /processors: \[[^\]]*tail_sampling/);
  assert.doesNotMatch(pipeline('traces/tail'), /probabilistic_sampler/, 'tail must not also sample by trace id before it sees the trace');
});

test('head keeps 10 percent, and tail keeps every error plus 10 percent of the rest', () => {
  assert.match(config, /probabilistic_sampler\/head:\s*\n\s+sampling_percentage: 10\s*\n/);
  const tail = config.split(/^  tail_sampling:/m)[1].split(/^\w/m)[0].split(/^exporters:/m)[0];
  assert.match(tail, /type: status_code\s*\n\s+status_code: \{ status_codes: \[ERROR\] \}/, 'tail lost its keep-errors policy');
  assert.match(tail, /type: probabilistic\s*\n\s+probabilistic: \{ sampling_percentage: 10 \}/, 'tail lost its 10 percent policy');
});

test('each policy writes its own file, which the tests read by name', () => {
  for (const name of ['all', 'head', 'tail']) {
    assert.match(config, new RegExp(`file/${name}:\\s*\\n\\s+path: /out/${name}\\.jsonl`));
    assert.match(pipeline(`traces/${name}`), new RegExp(`exporters: \\[file/${name}\\]`));
  }
});
