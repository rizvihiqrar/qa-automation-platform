import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverage, formatCoverage } from './coverage.ts';
import { exportGeneric } from './exporters/generic.ts';
import { exportMarkdown } from './exporters/markdown.ts';
import { exportTestRail } from './exporters/testrail.ts';
import { INTEGRATION_COMMANDS, runIntegration } from './integrate.ts';
import { DEFAULT_DATA_DIR, loadPlanDefinition, loadSuite } from './load.ts';
import { buildPlan } from './plan.ts';
import type { Issue } from './types.ts';
import { validatePlan, validateSuite } from './validate.ts';

export const FORMATS = ['testrail', 'generic', 'markdown'] as const;
const COMMANDS = ['validate', 'export', 'plan', 'coverage'] as const;

export interface Options {
  command: (typeof COMMANDS)[number];
  data: string;
  format: (typeof FORMATS)[number];
  out: string | null;
  json: boolean;
}

export function parseArgs(argv: string[]): Options {
  const [command, ...rest] = argv;
  if (!command || !(COMMANDS as readonly string[]).includes(command)) {
    throw new Error('Usage: cli.ts <' + [...COMMANDS, ...INTEGRATION_COMMANDS].join('|') + '> [--data <dir>] [--format <' + FORMATS.join('|') + '>] [--out <file>] [--json]');
  }
  const options: Options = { command: command as Options['command'], data: DEFAULT_DATA_DIR, format: 'testrail', out: null, json: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = () => {
      const next = rest[++i];
      if (next === undefined) throw new Error(flag + ' needs a value');
      return next;
    };
    if (flag === '--data') options.data = value();
    else if (flag === '--out') options.out = value();
    else if (flag === '--json') options.json = true;
    else if (flag === '--format') {
      const format = value();
      if (!(FORMATS as readonly string[]).includes(format)) throw new Error('Unknown format "' + format + '" (use ' + FORMATS.join(', ') + ')');
      options.format = format as Options['format'];
    } else throw new Error('Unknown option "' + flag + '"');
  }
  return options;
}

const describe = (issues: Issue[]) => issues.map((issue) => '  ' + issue.id + ': ' + issue.message).join('\n');

export function run(argv: string[]): { code: number; stdout: string; stderr: string } {
  const options = parseArgs(argv);
  const suite = loadSuite(options.data);
  const definition = loadPlanDefinition(options.data);
  const issues = [...validateSuite(suite), ...validatePlan(definition, suite)];

  if (options.command === 'validate') {
    if (issues.length) return { code: 1, stdout: '', stderr: issues.length + ' problem(s):\n' + describe(issues) + '\n' };
    return { code: 0, stdout: 'OK: ' + suite.cases.length + ' cases, ' + suite.sections.length + ' sections, ' + definition.runs.length + ' defined runs\n', stderr: '' };
  }
  // Nothing is exported, counted or planned from data that fails validation.
  if (issues.length) return { code: 1, stdout: '', stderr: 'Refusing to ' + options.command + ': ' + issues.length + ' problem(s):\n' + describe(issues) + '\n' };

  const plan = buildPlan(suite, definition);
  let output: string;
  if (options.command === 'coverage') output = options.json ? JSON.stringify(coverage(suite), null, 2) + '\n' : formatCoverage(coverage(suite));
  else if (options.command === 'plan') {
    output = options.json
      ? JSON.stringify(plan, null, 2) + '\n'
      : plan.name + '\n' + plan.runs.map((r) => '  ' + String(r.caseIds.length).padStart(3) + '  ' + r.name).join('\n') + '\n';
  } else if (options.format === 'testrail') output = exportTestRail(suite);
  else if (options.format === 'generic') output = exportGeneric(suite);
  else output = exportMarkdown(suite, plan);

  if (options.command === 'export' && options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, output);
    return { code: 0, stdout: 'Wrote ' + options.out + '\n', stderr: '' };
  }
  return { code: 0, stdout: output, stderr: '' };
}

// import.meta.main only exists from Node 24.2, so compare the script path instead.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const argv = process.argv.slice(2);
    const result = (INTEGRATION_COMMANDS as readonly string[]).includes(argv[0] ?? '') ? await runIntegration(argv) : run(argv);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.code;
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}
