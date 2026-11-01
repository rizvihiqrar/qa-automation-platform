import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../src/csv.ts';
import { exportGeneric } from '../src/exporters/generic.ts';
import { exportMarkdown } from '../src/exporters/markdown.ts';
import { exportTestRail, TESTRAIL_COLUMNS } from '../src/exporters/testrail.ts';
import { buildPlan } from '../src/plan.ts';
import { makeCase, makeSuite } from './helpers.ts';

test('toCsv doubles quotes and quotes fields with commas or line breaks', () => {
  const csv = toCsv([['plain', 'a,b', 'say "hi"', 'two\nlines']], { quoteAll: false, bom: false, eol: '\n' });
  assert.equal(csv, 'plain,"a,b","say ""hi""","two\nlines"\n');
});

test('toCsv writes the byte order mark and line ending it is told to', () => {
  const csv = toCsv([['a'], ['b']], { quoteAll: true, bom: true, eol: '\r\n' });
  assert.equal(csv, '﻿"a"\r\n"b"\r\n');
});

test('the TestRail export has the import header, section names and Untested status', () => {
  const lines = exportTestRail(makeSuite()).replace('﻿', '').split('\r\n');
  assert.equal(lines[0], TESTRAIL_COLUMNS.map((name) => '"' + name + '"').join(','));
  assert.equal(lines[1], '"AAA-001","First section","A title","A description","An expected result","High","Regression","Untested",""');
  assert.equal(lines.length, 4 + 2); // header, four cases, trailing newline
});

test('the TestRail export starts with a byte order mark and uses Windows line endings', () => {
  const csv = exportTestRail(makeSuite());
  assert.ok(csv.startsWith('﻿'));
  assert.ok(!/[^\r]\n/.test(csv), 'every line break is CRLF');
});

test('the TestRail export joins Jira keys with commas, and keeps quotes and commas in the text', () => {
  const suite = makeSuite();
  suite.cases[0] = makeCase({ title: 'Say "hi", then leave', references: ['QA-1', 'QA-2'] });
  const first = exportTestRail(suite).split('\r\n')[1];
  assert.ok(first?.includes('"Say ""hi"", then leave"'));
  assert.ok(first?.endsWith('"QA-1,QA-2"'));
});

test('the generic export has lower-case headers, no byte order mark and quotes only where needed', () => {
  const suite = makeSuite();
  suite.cases[0] = makeCase({ title: 'Has, a comma', references: ['QA-1', 'QA-2'] });
  const csv = exportGeneric(suite);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'id,section,title,description,expected_result,priority,type,references');
  assert.equal(lines[1], 'AAA-001,First section,"Has, a comma",A description,An expected result,High,Regression,QA-1;QA-2');
  assert.ok(!csv.startsWith('﻿'));
  assert.ok(!csv.includes('\r'));
});

test('the Markdown report lists counts, the plan and every case under its section', () => {
  const suite = makeSuite();
  const markdown = exportMarkdown(suite, buildPlan(suite, { name: 'Plan', runs: [{ name: 'Smoke', where: { priority: ['High'] } }] }));
  assert.match(markdown, /^# Sample test suite\n\n4 cases in 2 sections\./);
  assert.match(markdown, /\| First section \| 2 \|/);
  assert.match(markdown, /\| High \| 2 \|/);
  assert.match(markdown, /## Test plan: Plan/);
  assert.match(markdown, /\| Smoke \| 2 \|/);
  assert.match(markdown, /### Second section[\s\S]*\| BBB-001 \| A title \| High \| Security \|/);
});

test('the Markdown report keeps a trailing backslash from escaping the pipe after it', () => {
  const suite = makeSuite();
  suite.cases[0] = makeCase({ title: 'Path C:\\' });
  const markdown = exportMarkdown(suite, buildPlan(suite, { name: 'Plan', runs: [] }));
  assert.ok(markdown.includes('| AAA-001 | Path C:\\\\ | High |'));
});

test('the Markdown report keeps a pipe inside a cell from breaking the table', () => {
  const suite = makeSuite();
  suite.cases[0] = makeCase({ title: 'Debit | credit' });
  const markdown = exportMarkdown(suite, buildPlan(suite, { name: 'Plan', runs: [] }));
  assert.ok(markdown.includes('Debit \\| credit'));
});
