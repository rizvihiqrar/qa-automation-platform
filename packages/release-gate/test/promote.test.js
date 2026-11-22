import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { promote } from '../src/promote.js';
import { digestOf, retag } from '../src/registry.js';
import { parseArgs, toMarkdown } from '../src/promote-cli.js';

const OLD = `sha256:${'a'.repeat(64)}`;
const NEW = `sha256:${'b'.repeat(64)}`;

// Fake steps that remember what was called, with a registry of tag -> digest.
/** @returns {any} */
function fakeSteps({ smokePasses = true, built = NEW, tags = /** @type {Record<string, string>} */ ({ release: OLD }) } = {}) {
  const calls = [];
  const registry = { ...tags };
  return {
    calls,
    registry,
    build: async () => { calls.push('build'); registry.staging = built; return built; },
    smoke: async (digest) => { calls.push(`smoke ${digest}`); return { passed: smokePasses, detail: smokePasses ? 'ok' : 'red' }; },
    retag: async (digest, tag) => { calls.push(`retag ${digest} ${tag}`); registry[tag] = digest; },
    digestOf: async (tag) => registry[tag] ?? null,
  };
}

test('a green smoke run points the release tag at the image that was tested', async () => {
  const steps = fakeSteps();
  const result = await promote(steps);
  assert.deepEqual(steps.calls, ['build', `smoke ${NEW}`, `retag ${NEW} release`]);
  assert.deepEqual(result, { promoted: true, tested: NEW, released: NEW, previous: OLD, detail: 'ok' });
});

test('a red smoke run leaves the release tag untouched and never re-tags', async () => {
  const steps = fakeSteps({ smokePasses: false });
  const result = await promote(steps);
  assert.equal(result.promoted, false);
  assert.equal(result.released, OLD);
  assert.ok(!steps.calls.some((c) => c.startsWith('retag')), steps.calls.join(', '));
  assert.equal(steps.registry.release, OLD);
});

test('smoke runs against the digest that was built, never a tag', async () => {
  const steps = fakeSteps();
  await promote(steps);
  assert.match(steps.calls[1], /^smoke sha256:[0-9a-f]{64}$/);
});

test('the first release has nothing before it', async () => {
  const result = await promote(fakeSteps({ tags: {} }));
  assert.equal(result.previous, null);
  assert.equal(result.promoted, true);
});

test('it stops when the release tag ends up on a different image than the one tested', async () => {
  const steps = fakeSteps();
  steps.retag = async (digest, tag) => { steps.registry[tag] = OLD; };
  await assert.rejects(promote(steps), /was the image tested/);
});

test('it stops when the release tag moved although smoke failed', async () => {
  const steps = fakeSteps({ smokePasses: false });
  steps.smoke = async () => { steps.registry.release = NEW; return { passed: false }; };
  await assert.rejects(promote(steps), /smoke failed but the release tag moved/);
});

test('a build that does not return a digest is refused', async () => {
  await assert.rejects(promote(fakeSteps({ built: 'latest' })), /not an image digest/);
});

// A small stand-in for a registry: HEAD and GET read a manifest by tag or digest, PUT stores one.
async function fakeRegistry() {
  const byDigest = new Map();
  const tags = new Map();
  const puts = [];
  const server = http.createServer((req, res) => {
    const ref = req.url.split('/manifests/')[1];
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const digest = `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`;
        byDigest.set(digest, { body, type: req.headers['content-type'] });
        tags.set(ref, digest);
        puts.push({ ref, digest, type: req.headers['content-type'] });
        res.writeHead(201, { 'Docker-Content-Digest': digest }).end();
      });
      return;
    }
    const digest = ref.startsWith('sha256:') ? ref : tags.get(ref);
    const found = byDigest.get(digest);
    if (!found) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': found.type, 'Docker-Content-Digest': digest });
    res.end(req.method === 'HEAD' ? undefined : found.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  const seed = (tag, text, type = 'application/vnd.oci.image.index.v1+json') => {
    const body = Buffer.from(text);
    const digest = `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`;
    byDigest.set(digest, { body, type });
    tags.set(tag, digest);
    return digest;
  };
  return { base, seed, puts, tags, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('digestOf reads the digest a tag points to and says null for a tag that does not exist', async () => {
  const reg = await fakeRegistry();
  try {
    const d = reg.seed('staging', '{"image":1}');
    assert.equal(await digestOf(reg.base, 'app', 'staging'), d);
    assert.equal(await digestOf(reg.base, 'app', 'release'), null);
  } finally { await reg.close(); }
});

test('retag copies the manifest byte for byte, so the digest does not change', async () => {
  const reg = await fakeRegistry();
  try {
    const d = reg.seed('staging', '{"image":"exactly these bytes"}', 'application/vnd.docker.distribution.manifest.v2+json');
    await retag(reg.base, 'app', d, 'release');
    assert.equal(await digestOf(reg.base, 'app', 'release'), d);
    assert.deepEqual(reg.puts.map((p) => [p.ref, p.digest, p.type]), [['release', d, 'application/vnd.docker.distribution.manifest.v2+json']]);
  } finally { await reg.close(); }
});

test('retag of a digest the registry does not hold fails and creates no tag', async () => {
  const reg = await fakeRegistry();
  try {
    await assert.rejects(retag(reg.base, 'app', NEW, 'release'), /answered 404/);
    assert.equal(await digestOf(reg.base, 'app', 'release'), null);
  } finally { await reg.close(); }
});

test('parseArgs needs the registry, the repo, the context and the smoke command', () => {
  const ok = ['--registry', 'localhost:5000', '--repo', 'app', '--context', '.', '--smoke', 'npm test'];
  const opts = parseArgs([...ok, '--container-env', 'A=1', '--container-env', 'B=2']);
  assert.deepEqual(opts.containerEnv, ['A=1', 'B=2']);
  for (const missing of ['--registry', '--repo', '--context', '--smoke']) {
    const i = ok.indexOf(missing);
    assert.throws(() => parseArgs([...ok.slice(0, i), ...ok.slice(i + 2)]), new RegExp(`${missing} is required`));
  }
  assert.throws(() => parseArgs([...ok, '--bogus', 'x']), /Unknown argument/);
  assert.throws(() => parseArgs([...ok, '--label']), /needs a value/);
});

test('the summary says what was tested and where the release tag points', () => {
  const md = toMarkdown({ promoted: false, tested: NEW, released: OLD, previous: OLD, detail: 'smoke failed (exit 1)' });
  assert.match(md, /⛔ not promoted/);
  assert.match(md, new RegExp(`Image tested: \`${NEW}\``));
  assert.match(md, new RegExp(`now points to: \`${OLD}\``));
});

test('retag refuses a manifest the registry sent without a content type', async () => {
  const server = http.createServer((req, res) => { res.writeHead(200).end('{}'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  try {
    await assert.rejects(retag(base, 'app', NEW, 'release'), /no content type/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
