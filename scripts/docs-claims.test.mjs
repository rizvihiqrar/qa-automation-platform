// The stale-docs detector (scripts/docs-claims.mjs): first on small invented examples, then end to
// end on a throwaway git repository so each rule is shown to fail on its own, then on the real
// READMEs and technical guides.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { docFiles, findDrift, linkResolves, npmRunClaims, relativeLinks, trackedFiles } from './docs-claims.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('npm run claims: names are read whole, once each, and prose or flags are not part of them', () => {
  assert.deepEqual(npmRunClaims('Run `npm run report -- --month 2026-11` then `npm run test:ui`, then `npm run report` again.'), ['report', 'test:ui']);
  assert.deepEqual(npmRunClaims('![npm run flow: the refund is refused](docs/flow.png)'), ['flow']);
  assert.deepEqual(npmRunClaims('Use npm test or npx playwright test; neither is a script claim.'), []);
  assert.deepEqual(npmRunClaims('`npm run -w packages/x test` and `npm run --workspaces lint`'), [], 'flags are not script names');
  assert.deepEqual(npmRunClaims('`npm run x`'), ['x'], 'a one-letter name');
});

test('links: only files in this repo count, with anchors cut off and code examples skipped', () => {
  const text = [
    '[a](docs/a.md#top) [b](https://example.com/x) [c](#local) [d](mailto:x@y.z) ![e](docs/e.png)',
    '```',
    '[example](not/a/real/file.md)',
    '```',
    '[spaced](docs/my%20file.md) [template](../../packages/<package>/README.md)',
  ].join('\n');
  assert.deepEqual(relativeLinks(text), ['docs/a.md', 'docs/e.png', 'docs/my file.md']);
});

test('links: HTML images and anchors count, and a stray percent sign does not stop the run', () => {
  const text = '<img src="docs/banner.svg" width="80"> <a href=\'docs/guide.md\'>g</a> <a href="https://x.dev">web</a> [odd](docs/50%-done.md)';
  assert.deepEqual(relativeLinks(text).sort(), ['docs/50%-done.md', 'docs/banner.svg', 'docs/guide.md']);
});

test('links resolve against the file they are written in, to tracked files and folders only', () => {
  const tracked = new Set(['README.md', 'packages/x/README.md', 'packages/x/docs/a.png', '.github/workflows/ci.yml', '..hidden/note.md']);
  assert.ok(linkResolves('packages/x/README.md', 'docs/a.png', tracked));
  assert.ok(linkResolves('packages/x/README.md', 'docs/', tracked), 'a folder with tracked files in it');
  assert.ok(linkResolves('packages/x/README.md', '../../.github/workflows/ci.yml', tracked));
  assert.ok(linkResolves('packages/x/README.md', '/README.md', tracked), 'a leading slash means the repo root');
  assert.ok(linkResolves('README.md', '..hidden/note.md', tracked), 'a folder name that starts with two dots is not the parent folder');
  assert.ok(!linkResolves('packages/x/README.md', 'reports/2026-11.md', tracked), 'a file that is not tracked, ignored or never added');
  assert.ok(!linkResolves('packages/x/README.md', 'docs/b.png', tracked));
  assert.ok(!linkResolves('packages/x/README.md', '../../../outside.md', tracked), 'out of the repository');
});

// A throwaway repository: two packages, a root guide, one ignored folder.
function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-claims-'));
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  git('add', '-A');
  return dir;
}

const pkgJson = (scripts) => JSON.stringify({ scripts });
const goodRepo = () => ({
  '.gitignore': 'reports/\n',
  'package.json': pkgJson({ typecheck: 'x' }),
  'README.md': 'See [a](packages/a/README.md). Run `npm run smoke` in package a.\n',
  'packages/a/package.json': pkgJson({ smoke: 'x', report: 'x' }),
  'packages/a/README.md': 'Run `npm run report`, then `npm run typecheck` from the root. ![shot](docs/shot.png)\n',
  'packages/a/docs/shot.png': 'png',
  'packages/b/package.json': pkgJson({ other: 'x' }),
  'packages/b/README.md': 'Run `npm run other`.\n',
});

function driftFor(files, extra = () => {}) {
  const dir = makeRepo(files);
  try {
    extra(dir);
    return findDrift(dir).map((d) => `${d.file}: ${d.claim}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('end to end: a repository whose docs match its code has no drift', () => {
  assert.deepEqual(driftFor(goodRepo()), []);
});

test('end to end: a script the doc names but the package does not have is reported, with the file', () => {
  assert.deepEqual(driftFor({ ...goodRepo(), 'packages/b/README.md': 'Run `npm run report`.\n' }), ['packages/b/README.md: npm run report']);
});

test('end to end: a package script is not in scope for another package, only for the root guide', () => {
  const files = { ...goodRepo(), 'packages/b/README.md': 'Run `npm run smoke`.\n' };
  assert.deepEqual(driftFor(files), ['packages/b/README.md: npm run smoke']);
  const root = { ...goodRepo(), 'README.md': 'Run `npm run smoke` in package a, and `npm run nowhere`.\n' };
  assert.deepEqual(driftFor(root), ['README.md: npm run nowhere']);
});

test('end to end: a link to a moved file is reported', () => {
  const files = goodRepo();
  delete files['packages/a/docs/shot.png'];
  files['packages/a/docs/renamed.png'] = 'png';
  assert.deepEqual(driftFor(files), ['packages/a/README.md: docs/shot.png']);
});

test('end to end: a link to a file the .gitignore hides is reported although it is on disk', () => {
  const files = { ...goodRepo(), 'packages/a/README.md': 'See [report](reports/2026-11.md).\n' };
  const hidden = driftFor(files, (dir) => {
    fs.mkdirSync(path.join(dir, 'packages/a/reports'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages/a/reports/2026-11.md'), 'on this disk only');
    assert.ok(fs.existsSync(path.join(dir, 'packages/a/reports/2026-11.md')));
    spawnSync('git', ['add', '-A'], { cwd: dir }); // the ignored folder is skipped, as for a real commit
  });
  assert.deepEqual(hidden, ['packages/a/README.md: reports/2026-11.md']);
});

test('every Markdown file git tracks is read, in packages, docs and tools', () => {
  const files = docFiles(trackedFiles(ROOT)).map((d) => d.file);
  for (const expected of ['README.md', 'TECHNICAL.md', 'packages/ci-and-flaky-tooling/README.md', 'packages/ci-and-flaky-tooling/docs/revert.md', 'tools/playwright-lint/README.md']) {
    assert.ok(files.includes(expected), `${expected} is read`);
  }
});

test('no document names a script that does not exist', () => {
  const drift = findDrift(ROOT).filter((d) => d.claim.startsWith('npm run'));
  assert.deepEqual(drift, [], drift.map((d) => `${d.file}: ${d.claim} (${d.problem})`).join('\n'));
});

test('no document links to a file that is missing from the repository', () => {
  const drift = findDrift(ROOT).filter((d) => !d.claim.startsWith('npm run'));
  assert.deepEqual(drift, [], drift.map((d) => `${d.file}: ${d.claim} (${d.problem})`).join('\n'));
});
