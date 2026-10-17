import { test, expect } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { hashPassword, verifyPassword } from '../src/security/password.ts';

// Unit tests for password hashing (no server needed). The second test guards the
// root cause of the k6 finding directly: hashing on the main thread (bcryptjs,
// sync or async) stalled every other request for ~70 ms per login.
// See docs/rca/01-login-hashing-blocked-the-api.md.

test.describe('password hashing', () => {
  test('a hash verifies its own password and rejects others @regression', async () => {
    const stored = await hashPassword('Pass123!');
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await verifyPassword('Pass123!', stored)).toBe(true);
    expect(await verifyPassword('pass123!', stored)).toBe(false);
    expect(await verifyPassword('Pass123!', 'not-a-hash')).toBe(false);
    expect(await hashPassword('Pass123!')).not.toBe(stored); // fresh salt each time
  });

  test('hashing does not block the event loop @regression', async () => {
    // Event-loop utilization is the share of time the main thread was busy
    // rather than waiting for work. While eight logins' worth of hashing runs
    // off-thread, the loop mostly waits; hashing on the main thread keeps it
    // busy the whole time. A timer-based check was tried first and was flaky:
    // Windows timers tick every ~15 ms and parallel workers starve each other's
    // timers, while utilization barely moves under CPU contention.
    const before = performance.eventLoopUtilization();
    const start = performance.now();
    const hashes = await Promise.all(Array.from({ length: 8 }, (_, i) => hashPassword(`user-${i}`)));
    await Promise.all(hashes.map((h, i) => verifyPassword(`user-${i}`, h)));
    const elapsed = performance.now() - start;
    const { utilization } = performance.eventLoopUtilization(before);
    test.info().annotations.push({ type: 'event loop', description: `${(utilization * 100).toFixed(0)}% busy over ${elapsed.toFixed(0)} ms` });
    expect(elapsed, 'hashing finished too fast to measure').toBeGreaterThan(20);
    expect(utilization, 'share of the hashing time the main thread was busy').toBeLessThan(0.5);
  });
});
