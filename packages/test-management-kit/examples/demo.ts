// Runs the whole stage 2 flow against the local mock, so nothing leaves this machine:
// a weak failure report is refused, good ones become Jira issues, and the issue keys
// travel into the results sent to TestRail.
//   npm run demo
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIntegration } from '../src/integrate.ts';
import { startMock } from '../src/mock.ts';

const example = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const caseIds = Array.from({ length: 52 }, (_, i) => 101 + i);
const mock = await startMock({
  testrail: { user: 'qa@example.com', apiKey: 'demo-key', runs: { 1: caseIds } },
  jira: { email: 'qa@example.com', apiToken: 'demo-token', projects: ['KIT'] },
});
const env = { TESTRAIL_USER: 'qa@example.com', TESTRAIL_API_KEY: 'demo-key', JIRA_EMAIL: 'qa@example.com', JIRA_API_TOKEN: 'demo-token' };
const withKeys = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tmk-demo-')), 'run-results-with-keys.json');

// Each step states the exit code and the words it must print, so CI fails if the flow stops behaving this way.
async function step(title: string, argv: string[], expect: { code: number; text: RegExp }) {
  const result = await runIntegration(argv, env);
  const output = result.stdout + result.stderr;
  if (result.code !== expect.code || !expect.text.test(output)) {
    throw new Error('Demo step failed: ' + title + ' (exit ' + result.code + ')\n' + output);
  }
  console.log('$ ' + title);
  // The results file lives in a temp folder, so its path is left out to keep the output the same every run.
  const lines = output.trimEnd().split('\n').filter((l) => !l.startsWith('Wrote '));
  console.log(lines.map((l) => '  ' + l).join('\n') + '\n');
}

try {
  await step('create-jira  (a failure with no steps and no actual result)', ['create-jira', '--results', example('run-results-weak.json'), '--project', 'KIT', '--base-url', mock.url], { code: 1, text: /Not filing anything[\s\S]*No steps to reproduce/ });
  await step('create-jira  (two complete failures)', ['create-jira', '--results', example('run-results.json'), '--project', 'KIT', '--base-url', mock.url, '--out', withKeys], { code: 0, text: /OTC-002 -> KIT-1[\s\S]*OTC-005 -> KIT-2/ });
  await step('report-testrail  (the same run, now carrying the issue keys)', ['report-testrail', '--results', withKeys, '--map', example('testrail-map.json'), '--base-url', mock.url], { code: 0, text: /Reported 5 result\(s\) to run 1 \(5 stored\)/ });
  const sent = (mock.accepted.testrail[0] as { results: Array<{ case_id: number; defects?: string }> }).results;
  const filed = sent.filter((r) => r.defects).map((r) => 'case ' + r.case_id + ' -> ' + r.defects).join(', ');
  if (filed !== 'case 102 -> KIT-1, case 105 -> KIT-2') throw new Error('Demo check failed: TestRail received defects ' + filed);
  console.log('TestRail received defects: ' + filed);
} finally {
  await mock.close();
  fs.rmSync(path.dirname(withKeys), { recursive: true, force: true });
}
