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

test('Dependabot watches the Python package', () => {
  assert.match(fs.readFileSync(file, 'utf8'), /package-ecosystem: pip[\s\S]*directory: "\/packages\/api-pytest"/);
});
