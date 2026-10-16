import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../src/prompts/testPrompt.ts';
import { cleanOutput, generateTests, DEFAULT_MODEL } from '../src/generator.ts';
import { parseArgs } from '../src/generate.ts';
import type { MessageRequest, MessageResponse, MessagesClient } from '../src/generator.ts';

// A stand-in for the Anthropic client: records the request and returns a canned response.
function fakeClient(response: MessageResponse): MessagesClient & { calls: MessageRequest[] } {
  const calls: MessageRequest[] = [];
  return {
    calls,
    beta: { messages: { create: async (params) => { calls.push(params); return response; } } },
  };
}

const okResponse = (text: string, extra: Partial<MessageResponse> = {}): MessageResponse => ({
  model: DEFAULT_MODEL,
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
  usage: { input_tokens: 100, output_tokens: 50 },
  ...extra,
});

test('buildPrompt embeds the feature text and the selector rules', () => {
  const prompt = buildPrompt('Feature: Checkout');
  assert.match(prompt, /Feature: Checkout$/);
  assert.match(prompt, /data-test attribute selectors/);
  assert.match(prompt, /waitForTimeout/);
});

test('buildPrompt carries the navigation lesson from eval run claude-code-2026-10-16', () => {
  assert.match(buildPrompt('x'), /exists only on the new page/);
});

test('cleanOutput strips one outer markdown fence', () => {
  assert.equal(cleanOutput('```js\nconst a = 1;\n```'), 'const a = 1;\n');
  assert.equal(cleanOutput('```\nconst a = 1;\n```'), 'const a = 1;\n');
});

test('cleanOutput leaves unfenced code alone', () => {
  assert.equal(cleanOutput('  const a = 1;  '), 'const a = 1;\n');
});

test('generateTests sends the expected request and returns cleaned code', async () => {
  const client = fakeClient(okResponse('```js\ntest("x", async () => {});\n```'));
  const result = await generateTests(client, 'Feature: Login', { model: DEFAULT_MODEL });

  assert.equal(result.code, 'test("x", async () => {});\n');
  const [params] = client.calls;
  assert.ok(params, 'the client was not called');
  assert.equal(client.calls.length, 1);
  assert.equal(params.model, 'claude-opus-5-5');
  assert.equal(params.max_tokens, 16000);
  assert.deepEqual(params.output_config, { effort: 'high' });
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.match(params.messages[0]?.content ?? '', /Feature: Login/);
});

test('generateTests joins multiple text blocks and ignores thinking blocks', async () => {
  const client = fakeClient(okResponse('', {
    content: [
      { type: 'thinking', thinking: 'plan' },
      { type: 'text', text: 'line one\n' },
      { type: 'text', text: 'line two' },
    ],
  }));
  const { code } = await generateTests(client, 'x');
  assert.equal(code, 'line one\nline two\n');
});

test('generateTests throws a clear error on a refusal', async () => {
  const client = fakeClient(okResponse('', { stop_reason: 'refusal', stop_details: { category: 'cyber' } }));
  await assert.rejects(generateTests(client, 'x'), /declined.*cyber/);
});

test('generateTests throws when output is cut off at max_tokens', async () => {
  const client = fakeClient(okResponse('partial', { stop_reason: 'max_tokens' }));
  await assert.rejects(generateTests(client, 'x'), /max_tokens/);
});

test('generateTests throws when there is no text', async () => {
  const client = fakeClient(okResponse('   '));
  await assert.rejects(generateTests(client, 'x'), /no text/);
});

test('parseArgs requires --input and derives a default output path', () => {
  assert.throws(() => parseArgs([]), /Usage/);
  const args = parseArgs(['--input', 'examples/input/feature-cart.txt']);
  assert.match(args.output.replace(/\\/g, '/'), /^tests\/generated\/feature-cart\.spec\.js$/);
  assert.equal(parseArgs(['--input', 'a.txt', '--output', 'b.spec.js']).output, 'b.spec.js');
});
