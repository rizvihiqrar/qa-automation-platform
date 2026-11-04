// A new advisory in a dependency we do not choose (body-parser through express) turned the
// scheduled CI red on 2026-10-24 and 2026-10-25. Dependabot opens the lockfile bump as a pull
// request, so this keeps the config in place and covering every package.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, '.github', 'dependabot.yml');

test('Dependabot is configured', () => {
  assert.ok(fs.existsSync(file), 'add .github/dependabot.yml');
});

test('Dependabot watches the root, the tools and every package for npm', () => {
  const yml = fs.readFileSync(file, 'utf8');
  assert.match(yml, /package-ecosystem: npm/);
  for (const dir of ['"/"', '"/tools/*"', '"/packages/*"']) assert.ok(yml.includes(dir), `npm directories must include ${dir}`);
});

// Found by looking for requirements.txt, so a new Python package can't be missed (the second
// one, hcm-conversion-validation, was added by hand on 2026-11-04).
test('Dependabot watches every Python package', () => {
  const pip = fs.readFileSync(file, 'utf8').split(/package-ecosystem: /).find((block) => block.startsWith('pip')) ?? '';
  const packages = fs.readdirSync(path.join(ROOT, 'packages')).filter((p) => fs.existsSync(path.join(ROOT, 'packages', p, 'requirements.txt')));
  assert.ok(packages.length >= 2, 'expected api-pytest and hcm-conversion-validation');
  for (const p of packages) assert.ok(pip.includes(`"/packages/${p}"`), `add "/packages/${p}" to the pip directories in .github/dependabot.yml`);
});
