import { test, expect } from '@playwright/test';
import { AttemptLimiter } from '../src/security/rate-limit.ts';

// Unit tests for the sign-in attempt limiter (no server needed), with a fake clock
// for what the API tests can't wait for: the window ending. The limit at the API
// is tested in tests/design (TC-BVA-23 to 25, TC-DT-18 to 23).

const WINDOW = 15 * 60 * 1000;

function limiter() {
  let now = 1_000_000;
  const l = new AttemptLimiter(5, WINDOW, () => now);
  return { l, advance: (ms: number) => { now += ms; } };
}

test.describe('sign-in attempt limiter', () => {
  test('refuses the 6th attempt until the window ends, then allows again @regression', () => {
    const { l, advance } = limiter();
    for (let i = 0; i < 5; i++) expect(l.attempt('k').allowed).toBe(true);
    expect(l.attempt('k')).toEqual({ allowed: false, retryAfterSeconds: 900 });
    advance(WINDOW - 1000);
    expect(l.attempt('k')).toEqual({ allowed: false, retryAfterSeconds: 1 });
    advance(1000);
    expect(l.attempt('k').allowed).toBe(true);
  });

  test('the window runs from the first attempt, not the latest @regression', () => {
    const { l, advance } = limiter();
    l.attempt('k');
    advance(WINDOW - 1);
    for (let i = 0; i < 4; i++) l.attempt('k');
    expect(l.attempt('k').allowed).toBe(false);
    advance(1);
    expect(l.attempt('k').allowed).toBe(true);
  });

  test('a success clears the count, and keys are counted apart @regression', () => {
    const { l } = limiter();
    for (let i = 0; i < 5; i++) l.attempt('a');
    expect(l.attempt('b').allowed).toBe(true);
    l.succeeded('a');
    expect(l.attempt('a').allowed).toBe(true);
  });

  test('expired entries are dropped, so made-up emails don\'t pile up @regression', () => {
    const { l, advance } = limiter();
    for (let i = 0; i < 1000; i++) l.attempt(`guess-${i}`);
    expect(l.size).toBe(1000);
    advance(WINDOW);
    l.attempt('next');
    expect(l.size).toBe(1);
  });
});
