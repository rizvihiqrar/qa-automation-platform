/**
 * Pattern: Latency and SLA validation
 *
 * AI endpoints are slower than regular APIs — but they still need upper bounds.
 * These tests assert time-to-first-response is within your agreed SLA.
 * A slow model rollout or infrastructure issue will surface here first.
 */

import { test, expect } from '@playwright/test';
import { chat } from '../utils/aiClient.js';

const SLA_MS = 5000; // 5 second SLA for a complete response

test.describe('Pattern: AI latency and SLA', () => {

  test('standard request completes within SLA @smoke', async ({ request }) => {
    const start = Date.now();
    const res   = await chat({ messages: [{ role: 'user', content: 'Hello' }] }, request);
    const elapsed = Date.now() - start;

    expect(res.status()).toBe(200);
    expect(elapsed, `Response took ${elapsed}ms — exceeded ${SLA_MS}ms SLA`).toBeLessThan(SLA_MS);
  });

  test('response time is logged for monitoring @regression', async ({ request }) => {
    const start = Date.now();
    const res   = await chat({ messages: [{ role: 'user', content: 'What is 2+2?' }] }, request);
    const elapsed = Date.now() - start;

    // Log for observability — teams wire this to Grafana/DataDog in production
    console.log(`AI response latency: ${elapsed}ms`);

    expect(res.status()).toBe(200);
    expect(elapsed).toBeLessThan(SLA_MS);
  });

  test('slow response correctly fails the SLA threshold @regression', async ({ request }) => {
    // The mock server adds a 6 s delay when prompt contains "simulate_slow"
    const start = Date.now();
    const res = await chat(
      { messages: [{ role: 'user', content: 'simulate_slow request' }] },
      request
    ).catch(() => null);
    const elapsed = Date.now() - start;

    // Either the request times out (null) or takes longer than the SLA
    // Either outcome confirms the SLA check catches the degradation
    if (res !== null) {
      expect(elapsed, 'Slow response should exceed the SLA').toBeGreaterThanOrEqual(SLA_MS);
    } else {
      expect(elapsed).toBeGreaterThanOrEqual(SLA_MS);
    }
  }, 15000); // Extended timeout for this test only

});
