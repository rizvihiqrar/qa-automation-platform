// The promptfoo replay provider answers only for the exact prompt the judge answered.
// Day 40 shipped with this check switched off (one of its deliberate breaks was left
// in); src/eval.ts still caught a changed prompt, but the provider itself did not.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error plain JavaScript module with no type declarations
import ReplayProvider from '../promptfoo/replay-provider.mjs';
import { loadItems, render, template } from '../src/render.ts';

const provider = new ReplayProvider({ config: { run: 'haiku-v2-1' } });
const item = loadItems()[0]!;
const prompt = render(item, template('v2'));

test('the replay provider answers the prompt the judge saw', async () => {
  const res = await provider.callApi(prompt, { vars: { id: item.id } });
  assert.equal(res.error, undefined);
  assert.ok(['covered', 'partial', 'missing'].includes(JSON.parse(res.output).verdict));
});

test('the replay provider refuses a prompt that differs by one character', async () => {
  const res = await provider.callApi(prompt.replace('Criterion', 'Criterion '), { vars: { id: item.id } });
  assert.match(res.error, /rendered prompt differs/);
  assert.equal(res.output, undefined);
});

test('the replay provider refuses a case the run never answered', async () => {
  const res = await provider.callApi(prompt, { vars: { id: 'J99' } });
  assert.match(res.error, /no answer for J99/);
});
