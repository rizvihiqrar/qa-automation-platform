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

// Pull request 137 (2026-11-04) bumped the OTLP exporters to 0.300 and left sdk-trace-node on 2.x,
// which npm cannot resolve, so seven CI jobs failed at npm ci. The packages move as one group, and
// the exporters and api stay held back while the SDK package is still on 2.x.
const npmBlock = () => fs.readFileSync(file, 'utf8').split(/package-ecosystem: /).find((block) => block.startsWith('npm')) ?? '';

test('the OpenTelemetry packages are one Dependabot group', () => {
  assert.match(npmBlock(), /opentelemetry:\s*\n\s*patterns: \["@opentelemetry\/\*"\]/);
});

test('the OpenTelemetry hold-back lasts exactly as long as sdk-trace-node is on 2.x', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'qa-practice-api', 'package.json'), 'utf8'));
  const range = pkg.dependencies?.['@opentelemetry/sdk-trace-node'];
  assert.ok(range, 'sdk-trace-node is a dependency of qa-practice-api: update this test if it moved');
  const held = /^[\^~]?2\./.test(range);
  const block = npmBlock();
  const entries = [/dependency-name: "@opentelemetry\/\*"\s*\n\s*update-types: \["version-update:semver-major"\]/, /dependency-name: "@opentelemetry\/api"\s*\n\s*versions: \[">=1\.10\.0"\]/, /dependency-name: "@opentelemetry\/exporter-\*"\s*\n\s*versions: \[">=0\.300\.0"\]/];
  for (const entry of entries) {
    if (held) assert.match(block, entry, 'sdk-trace-node is on 2.x: keep the OpenTelemetry hold-back in .github/dependabot.yml');
    else assert.doesNotMatch(block, entry, 'sdk-trace-node moved past 2.x: remove the OpenTelemetry hold-back from .github/dependabot.yml');
  }
});

// Dependabot pull requests 184 and 185 (2026-11-17) bumped express to 5 and failed six
// qa-practice-api tests. The major stays held back until that package runs on express 5, so the
// same pull requests do not come back every Monday.
test('express majors stay held back while any package is still on express 4', () => {
  // The hold-back is global (Dependabot cannot ignore per directory), so it lasts until no package
  // is left on a 4.x range, for express and for its types separately.
  const ranges = { express: [], '@types/express': [] };
  for (const dir of fs.readdirSync(path.join(ROOT, 'packages'))) {
    const file = path.join(ROOT, 'packages', dir, 'package.json');
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const name of Object.keys(ranges)) {
      const range = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
      if (range) ranges[name].push(range);
    }
  }
  assert.ok(ranges.express.length >= 2, 'expected qa-practice-api and pipeline-templates-demo to depend on express: update this test if that moved');
  const block = npmBlock();
  for (const [name, found] of Object.entries(ranges)) {
    const held = found.some((range) => /^\D*4(\D|$)/.test(range));
    const entry = new RegExp(String.raw`dependency-name: "${name}"\s*\n\s*update-types: \["version-update:semver-major"\]`);
    if (held) assert.match(block, entry, `a package is still on ${name} 4: keep the major hold-back in .github/dependabot.yml`);
    else assert.doesNotMatch(block, entry, `no package is on ${name} 4 any more: remove the major hold-back from .github/dependabot.yml`);
  }
});

// Found by looking for requirements.txt, so a new Python package can't be missed (the second
// one, hcm-conversion-validation, was added by hand on 2026-11-04).
test('Dependabot watches every Python package', () => {
  const pip = fs.readFileSync(file, 'utf8').split(/package-ecosystem: /).find((block) => block.startsWith('pip')) ?? '';
  const packages = fs.readdirSync(path.join(ROOT, 'packages')).filter((p) => fs.existsSync(path.join(ROOT, 'packages', p, 'requirements.txt')));
  assert.ok(packages.length >= 2, 'expected api-pytest and hcm-conversion-validation');
  for (const p of packages) assert.ok(pip.includes(`"/packages/${p}"`), `add "/packages/${p}" to the pip directories in .github/dependabot.yml`);
});
