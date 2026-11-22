// Build promotion gated on smoke: build the image once, run smoke against that exact
// image, and only then point the release tag at it. Every step that touches Docker or
// the registry is passed in, so the rules are tested with fakes and the real thing is
// proven in integration/promotion.test.js.

/**
 * @param {{
 *   build: () => Promise<string>,
 *   smoke: (digest: string) => Promise<{ passed: boolean, detail?: string }>,
 *   retag: (digest: string, tag: string) => Promise<void>,
 *   digestOf: (tag: string) => Promise<string | null>,
 *   tags?: { release: string },
 * }} steps
 */
export async function promote({ build, smoke, retag, digestOf, tags = { release: 'release' } }) {
  const before = await digestOf(tags.release);
  const tested = await build();
  if (!/^sha256:[0-9a-f]{64}$/.test(tested)) throw new Error(`build returned "${tested}", not an image digest`);

  const result = await smoke(tested);
  if (!result.passed) {
    // A red smoke run leaves the release tag exactly where it was.
    const after = await digestOf(tags.release);
    if (after !== before) throw new Error(`smoke failed but the ${tags.release} tag moved from ${before} to ${after}`);
    return { promoted: false, tested, released: after, previous: before, detail: result.detail ?? 'smoke failed' };
  }

  await retag(tested, tags.release);
  const released = await digestOf(tags.release);
  // What is released must be the image that was tested, not a rebuild of it.
  if (released !== tested) throw new Error(`the ${tags.release} tag points to ${released}, but ${tested} was the image tested`);
  return { promoted: true, tested, released, previous: before, detail: result.detail ?? 'smoke passed' };
}
