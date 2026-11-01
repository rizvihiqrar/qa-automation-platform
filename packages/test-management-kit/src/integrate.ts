import fs from 'node:fs';
import path from 'node:path';
import { redact } from './http.ts';
import { blockedDrafts, createIssues, PartialFilingError, prepareIssues } from './jira.ts';
import { DEFAULT_DATA_DIR, loadPlanDefinition, loadSuite } from './load.ts';
import { validateResults } from './results.ts';
import type { CaseResult, ResultsFile } from './results.ts';
import { buildResults, planAddResults, reportResults, validateMap } from './testrail.ts';
import type { CaseMap } from './testrail.ts';
import type { Issue } from './types.ts';
import { validatePlan, validateSuite } from './validate.ts';

export const INTEGRATION_COMMANDS = ['report-testrail', 'create-jira'] as const;
type Command = (typeof INTEGRATION_COMMANDS)[number];

interface Options {
  command: Command;
  data: string;
  results: string;
  map: string | null;
  baseUrl: string | null;
  runId: number | null;
  project: string | null;
  out: string | null;
  dryRun: boolean;
}

const USAGE =
  'Usage: cli.ts report-testrail --results <file> --map <file> --base-url <url> [--run-id <n>] [--dry-run]\n' +
  '       cli.ts create-jira --results <file> --project <KEY> --base-url <url> [--out <file>] [--dry-run]\n' +
  'Credentials come from TESTRAIL_USER and TESTRAIL_API_KEY, or JIRA_EMAIL and JIRA_API_TOKEN.';

export function parseIntegrationArgs(argv: string[]): Options {
  const [command, ...rest] = argv;
  if (!command || !(INTEGRATION_COMMANDS as readonly string[]).includes(command)) throw new Error(USAGE);
  const options: Options = { command: command as Command, data: DEFAULT_DATA_DIR, results: '', map: null, baseUrl: null, runId: null, project: null, out: null, dryRun: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = () => {
      const next = rest[++i];
      if (next === undefined) throw new Error(flag + ' needs a value');
      return next;
    };
    if (flag === '--data') options.data = value();
    else if (flag === '--results') options.results = value();
    else if (flag === '--map') options.map = value();
    else if (flag === '--base-url') options.baseUrl = value();
    else if (flag === '--project') options.project = value();
    else if (flag === '--out') options.out = value();
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--run-id') {
      const n = Number(value());
      if (!Number.isInteger(n) || n <= 0) throw new Error('--run-id must be a positive whole number');
      options.runId = n;
    } else throw new Error('Unknown option "' + flag + '"');
  }
  if (!options.results) throw new Error('--results is required\n' + USAGE);
  // An option that does nothing for this command is an error, so nobody thinks --out wrote a file when it did not.
  const notFor: Record<Command, Array<[string, boolean]>> = {
    'report-testrail': [['--project', options.project !== null], ['--out', options.out !== null]],
    'create-jira': [['--map', options.map !== null], ['--run-id', options.runId !== null]],
  };
  const unused = notFor[options.command].find(([, given]) => given);
  if (unused) throw new Error(unused[0] + ' does not apply to ' + options.command + '\n' + USAGE);
  return options;
}

const describe = (issues: Issue[]) => issues.map((issue) => '  ' + issue.id + ': ' + issue.field + ': ' + issue.message).join('\n');

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error('Could not read ' + file + ': ' + (error instanceof Error ? error.message : String(error)));
  }
}

/** Passwords and tokens must not cross the network in the clear, so plain http is for this machine only. */
export function checkBaseUrl(raw: string | null): string {
  if (!raw) throw new Error('--base-url is required');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('--base-url is not a valid address: ' + raw);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('--base-url must use https (http is allowed only for localhost): ' + raw);
  }
  return raw;
}

function secret(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error('Set the ' + name + ' environment variable (credentials are never taken from options)');
  return value;
}

const fail = (stderr: string) => ({ code: 1, stdout: '', stderr });

export async function runIntegration(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  sleep?: (ms: number) => Promise<void>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const options = parseIntegrationArgs(argv);
  const suite = loadSuite(options.data);
  const dataIssues = [...validateSuite(suite), ...validatePlan(loadPlanDefinition(options.data), suite)];
  if (dataIssues.length) return fail('Refusing to ' + options.command + ': ' + dataIssues.length + ' problem(s) in the case data:\n' + describe(dataIssues) + '\n');

  const file = readJson(options.results);
  const resultIssues = validateResults(file, suite);
  if (resultIssues.length) return fail('Refusing to ' + options.command + ': ' + resultIssues.length + ' problem(s) in ' + options.results + ':\n' + describe(resultIssues) + '\n');
  const { results, runId: fileRunId } = file as ResultsFile;
  const baseUrl = checkBaseUrl(options.baseUrl);

  if (options.command === 'report-testrail') {
    if (!options.map) return fail('--map is required (case id to TestRail id)\n');
    const map = readJson(options.map);
    const mapIssues = validateMap(map, suite);
    if (mapIssues.length) return fail('Refusing to report: ' + mapIssues.length + ' problem(s) in ' + options.map + ':\n' + describe(mapIssues) + '\n');
    const runId = options.runId ?? fileRunId;
    if (!runId) return fail('Give the run with --run-id, or a runId in the results file\n');

    if (options.dryRun) {
      return { code: 0, stdout: 'Dry run, nothing sent:\n' + redact(planAddResults(baseUrl, runId, buildResults(results, map as CaseMap))) + '\n', stderr: '' };
    }
    const sent = await reportResults({ baseUrl, user: secret(env, 'TESTRAIL_USER'), apiKey: secret(env, 'TESTRAIL_API_KEY') }, runId, results, map as CaseMap, { sleep });
    return { code: 0, stdout: 'Reported ' + results.length + ' result(s) to run ' + runId + ' (' + sent.length + ' stored)\n', stderr: '' };
  }

  if (!options.project) return fail('--project is required (the Jira project key)\n');
  if (!/^[A-Z][A-Z0-9_]+$/.test(options.project)) return fail('--project must be a Jira project key such as KIT\n');
  const { drafts, alreadyFiled } = prepareIssues(results, suite, options.project, baseUrl);
  const notes = alreadyFiled.length ? 'Already filed, skipped: ' + alreadyFiled.join(', ') + '\n' : '';
  const blocked = blockedDrafts(drafts);
  if (blocked.length) {
    const lines = blocked.flatMap((d) => d.lint.findings.filter((f) => f.severity === 'error').map((f) => '  ' + d.caseId + ': ' + f.message));
    return fail('Not filing anything: ' + blocked.length + ' failed case(s) are not ready for a developer (defect-report-linter):\n' + lines.join('\n') + '\n');
  }
  const warnings = drafts.flatMap((d) => d.lint.findings.map((f) => '  ' + d.caseId + ': ' + f.message));
  const warningText = warnings.length ? 'Warnings:\n' + warnings.join('\n') + '\n' : '';

  if (options.dryRun) {
    return { code: 0, stdout: notes + warningText + 'Dry run, nothing sent: ' + drafts.length + ' issue(s)\n' + drafts.map((d) => redact(d.request)).join('\n\n') + '\n', stderr: '' };
  }
  const connection = { baseUrl, email: secret(env, 'JIRA_EMAIL'), apiToken: secret(env, 'JIRA_API_TOKEN') };
  const save = (keys: Record<string, string>) => {
    if (!options.out) return;
    const updated: CaseResult[] = results.map((r) => (keys[r.caseId] ? { ...r, defects: keys[r.caseId] } : r));
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify({ ...(file as ResultsFile), results: updated }, null, 2) + '\n');
  };
  const listKeys = (keys: Record<string, string>) => Object.entries(keys).map(([caseId, key]) => '  ' + caseId + ' -> ' + key).join('\n');
  // If the file cannot be written the issues already exist in Jira, so the keys are printed instead of lost.
  const trySave = (keys: Record<string, string>): string | null => {
    try {
      save(keys);
      return null;
    } catch (error) {
      return 'Could not write ' + options.out + ': ' + (error instanceof Error ? error.message : String(error)) + '\nThe issues are filed. Put these keys in each result\'s defects field by hand before running again, or a re-run files duplicates:\n' + listKeys(keys) + '\n';
    }
  };
  try {
    const keys = await createIssues(connection, drafts, { sleep });
    const unsaved = trySave(keys);
    if (unsaved) return fail(unsaved);
    return { code: 0, stdout: notes + warningText + 'Filed ' + drafts.length + ' issue(s)' + (drafts.length ? ':\n' + listKeys(keys) : '') + '\n' + (options.out ? 'Wrote ' + options.out + '\n' : ''), stderr: '' };
  } catch (error) {
    if (error instanceof PartialFilingError) {
      const unsaved = trySave(error.created);
      if (unsaved) return fail(error.message + '\n' + unsaved);
      return fail(error.message + (options.out ? '\nThe issues filed so far are saved in ' + options.out + '; fix the problem and run again with that file.' : '\nNo --out file was given, so those keys are lost; check the project for duplicates.') + '\n');
    }
    throw error;
  }
}
