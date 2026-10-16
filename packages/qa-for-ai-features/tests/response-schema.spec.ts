/**
 * Pattern: Response schema validation
 *
 * AI APIs can change their response shape across model versions.
 * These tests assert the exact contract your app depends on — if the shape
 * breaks, this catches it before it reaches users.
 *
 * Swap AI_BASE_URL env var to point at a real AI API (Claude, OpenAI, etc.)
 * and these same assertions apply.
 */

import { test, expect } from '@playwright/test';
import { chat, assertResponseSchema } from '../utils/aiClient.ts';

test.describe('Pattern: AI response schema validation', () => {

  test('response contains all required top-level fields @smoke', async ({ request }) => {
    const res  = await chat({ messages: [{ role: 'user', content: 'Hello' }] }, request);
    const body = await res.json();

    expect(res.status()).toBe(200);
    assertResponseSchema(body); // throws if any required field is missing
  });

  test('content array contains at least one text block @smoke', async ({ request }) => {
    const res  = await chat({ messages: [{ role: 'user', content: 'Hello' }] }, request);
    const body = await res.json();

    expect(Array.isArray(body.content)).toBe(true);
    expect(body.content.length).toBeGreaterThan(0);
    expect(body.content[0].type).toBe('text');
    expect(typeof body.content[0].text).toBe('string');
    expect(body.content[0].text.length).toBeGreaterThan(0);
  });

  test('usage object reports numeric token counts @regression', async ({ request }) => {
    const res  = await chat({ messages: [{ role: 'user', content: 'Hello' }] }, request);
    const body = await res.json();

    expect(typeof body.usage.input_tokens).toBe('number');
    expect(typeof body.usage.output_tokens).toBe('number');
    expect(body.usage.input_tokens).toBeGreaterThan(0);
    expect(body.usage.output_tokens).toBeGreaterThan(0);
  });

  test('a malformed request gets a 400, and the API keeps serving @regression', async ({ request }) => {
    const bad = await request.post('http://localhost:3031/v1/messages', {
      headers: { 'Content-Type': 'application/json' },
      // A Buffer is sent as-is; a string would be JSON-encoded into valid JSON.
      data: Buffer.from('{"messages": ['),
    });
    expect(bad.status()).toBe(400);

    const res = await chat({ messages: [{ role: 'user', content: 'Hello' }] }, request);
    expect(res.status()).toBe(200);
  });

  test('stop_reason is a known value @regression', async ({ request }) => {
    const res  = await chat({ messages: [{ role: 'user', content: 'Hello' }] }, request);
    const body = await res.json();

    const knownStopReasons = ['end_turn', 'max_tokens', 'stop_sequence', 'tool_use'];
    expect(knownStopReasons).toContain(body.stop_reason);
  });

});
