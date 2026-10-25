import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { sdkClient } from '../src/sdkClient.ts';
import type { MessageRequest } from '../src/generator.ts';

// A stand-in for the SDK client with the shape its beta.messages.create() returns.
// The cast is test-only: typecheck already holds sdkClient.ts to the real SDK types;
// this checks what the adapter does with a response.
function fakeSdk(message: Record<string, unknown>) {
  const calls: unknown[] = [];
  const client = { beta: { messages: { create: async (params: unknown) => (calls.push(params), message) } } };
  return { client: client as unknown as Anthropic, calls };
}

const request: MessageRequest = {
  model: 'claude-opus-5-5',
  max_tokens: 16000,
  output_config: { effort: 'high' },
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
  messages: [{ role: 'user', content: 'feature' }],
};

const usage = { input_tokens: 12, output_tokens: 34, cache_read_input_tokens: 0 };

test('sends the request unchanged as a non-streaming call', async () => {
  const { client, calls } = fakeSdk({ model: 'm', stop_reason: 'end_turn', stop_details: null, content: [], usage });
  await sdkClient(client).beta.messages.create(request);
  assert.deepEqual(calls, [{ ...request, stream: false }]);
});

test('keeps text blocks in order and leaves out thinking, fallback and tool blocks', async () => {
  const content = [
    { type: 'thinking', thinking: '', signature: 's' },
    { type: 'text', text: 'one ' },
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
    { type: 'redacted_thinking', data: 'x' },
    { type: 'text', text: 'two' },
  ];
  const { client } = fakeSdk({ model: 'claude-opus-5', stop_reason: 'end_turn', stop_details: null, content, usage });
  const res = await sdkClient(client).beta.messages.create(request);
  assert.deepEqual(res.content, [{ type: 'text', text: 'one ' }, { type: 'text', text: 'two' }]);
  assert.equal(res.model, 'claude-opus-5', 'the model that answered, which may be a fallback');
  assert.deepEqual(res.usage, { input_tokens: 12, output_tokens: 34 });
});

test('passes stop details through, including a refusal with no category', async () => {
  for (const stop_details of [null, { type: 'refusal', category: 'cyber', explanation: 'e' }, { type: 'refusal', category: null, explanation: null }]) {
    const { client } = fakeSdk({ model: 'm', stop_reason: stop_details ? 'refusal' : 'end_turn', stop_details, content: [], usage });
    const res = await sdkClient(client).beta.messages.create(request);
    assert.deepEqual(res.stop_details, stop_details);
    assert.equal(res.stop_reason, stop_details ? 'refusal' : 'end_turn');
  }
});
