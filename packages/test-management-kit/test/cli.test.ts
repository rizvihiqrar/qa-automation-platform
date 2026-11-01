import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, run } from '../src/cli.ts';
import { DEFAULT_DATA_DIR } from '../src/load.ts';
import { makeCase, makeSuite } from './helpers.ts';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const plan = { name: 'P', runs: [{ name: 'Smoke', where: { priority: ['High'] } }] };

function dataDir(suite = makeSuite()): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(suite));
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan));
  return dir;
}

test('parseArgs applies defaults', () => {
  assert.deepEqual(parseArgs(['export']), { command: 'export', data: DEFAULT_DATA_DIR, format: 'testrail', out: null, json: false });
});

test('parseArgs rejects unknown commands, formats and options, and a flag with no value', () => {
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(['import']), /Usage/);
  assert.throws(() => parseArgs(['export', '--format', 'xml']), /Unknown format "xml"/);
  assert.throws(() => parseArgs(['export', '--nope']), /Unknown option "--nope"/);
  assert.throws(() => parseArgs(['export', '--out']), /--out needs a value/);
});

test('validate passes clean data and says how much it checked', () => {
  const result = run(['validate', '--data', dataDir()]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /OK: 4 cases, 2 sections, 1 defined runs/);
});

test('validate exits 1 and lists every problem', () => {
  const suite = makeSuite();
  suite.cases[0] = makeCase({ priority: 'Urgent', title: '' });
  const result = run(['validate', '--data', dataDir(suite)]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /2 problem\(s\)/);
  assert.match(result.stderr, /Missing title/);
  assert.match(result.stderr, /Unknown priority "Urgent"/);
});

test('export, plan and coverage refuse to run on invalid data', () => {
  const suite = makeSuite();
  suite.cases[1] = makeCase({ id: 'AAA-001' });
  const dir = dataDir(suite);
  for (const command of ['export', 'plan', 'coverage']) {
    const result = run([command, '--data', dir]);
    assert.equal(result.code, 1, command);
    assert.equal(result.stdout, '', command);
    assert.match(result.stderr, /Refusing to/, command);
  }
});

test('export writes the file and creates missing folders', () => {
  const out = path.join(dataDir(), 'deeper', 'cases.csv');
  const result = run(['export', '--format', 'generic', '--data', path.dirname(path.dirname(out)), '--out', out]);
  assert.equal(result.code, 0);
  assert.match(fs.readFileSync(out, 'utf8'), /^id,section,title/);
});

test('coverage and plan print JSON on request', () => {
  const dir = dataDir();
  assert.equal(JSON.parse(run(['coverage', '--json', '--data', dir]).stdout).total, 4);
  assert.equal(JSON.parse(run(['plan', '--json', '--data', dir]).stdout).runs.length, 3);
});

test('the broken sample in examples fails with the six problems the README shows', () => {
  const result = run(['validate', '--data', fileURLToPath(new URL('../examples/broken-data', import.meta.url))]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^6 problem\(s\):/);
  for (const expected of ['"OTC-001" is repeated', 'Missing expectedResult', 'Unknown priority "Urgent"', 'Unknown type "Smoke"', 'Run "Integration" selects no cases']) {
    assert.ok(result.stderr.includes(expected), expected);
  }
});

test('the CLI process exits 1 with a message when the data folder is missing', () => {
  const result = spawnSync(process.execPath, [CLI, 'validate', '--data', path.join(os.tmpdir(), 'no-such-kit-folder')], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not read/);
});

test('the CLI process validates the shipped data and exits 0', () => {
  const result = spawnSync(process.execPath, [CLI, 'validate'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^OK: 52 cases, 8 sections/);
});
