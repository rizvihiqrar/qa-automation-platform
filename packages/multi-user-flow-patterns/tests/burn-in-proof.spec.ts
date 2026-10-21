// DELIBERATE BREAK for the burn-in PR, removed in its next commit: passes on a single
// run (the regular CI job), fails on the third repeat (burn-in).
import { expect, test } from '@playwright/test';

test('burn-in proof: fails only on its third run', ({}, info) => {
  expect(info.repeatEachIndex).toBeLessThan(2);
});
