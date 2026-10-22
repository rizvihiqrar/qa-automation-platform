// Proof that the model answer catches each planted bug, and only that bug.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHECKS } from '../src/model-answer.ts';
import { BUGS, replaceOnce, startVariant } from '../src/plant.ts';

async function results(ids: string[]): Promise<Record<string, { ok: boolean; seen: string }>> {
  const variant = await startVariant(ids);
  try {
    const out: Record<string, { ok: boolean; seen: string }> = {};
    for (const check of CHECKS) out[check.id] = await check.run(variant.base);
    return out;
  } finally {
    await variant.stop();
  }
}
const failing = (r: Record<string, { ok: boolean }>) => Object.keys(r).filter((id) => !r[id]!.ok);

test('there is one check and one bug for each of the six objectives', () => {
  const ids = ['O1', 'O2', 'O3', 'O4', 'O5', 'O6'];
  assert.deepEqual(CHECKS.map((c) => c.id), ids);
  assert.deepEqual(BUGS.map((b) => b.id), ids);
});

test('against the unchanged banking API every check passes', async () => {
  const r = await results([]);
  assert.deepEqual(failing(r), [], JSON.stringify(r));
});

for (const bug of BUGS) {
  test(`${bug.id} planted (${bug.title}): the model answer catches it, and no other check fires`, async () => {
    const r = await results([bug.id]);
    assert.deepEqual(failing(r), [bug.id], JSON.stringify(r));
  });
}

test('with all six planted, all six checks fail', async () => {
  const r = await results(BUGS.map((b) => b.id));
  assert.deepEqual(failing(r), ['O1', 'O2', 'O3', 'O4', 'O5', 'O6'], JSON.stringify(r));
});

test('a bug whose line is not found exactly once is refused, not silently skipped', () => {
  assert.throws(() => replaceOnce('abc', 'x', 'y'), /found 0/);
  assert.throws(() => replaceOnce('xx', 'x', 'y'), /found 2/);
  assert.equal(replaceOnce('abc', 'b', ''), 'ac');
});
