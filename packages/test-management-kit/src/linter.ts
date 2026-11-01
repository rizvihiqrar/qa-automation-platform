// The defect-report-linter package is plain JavaScript with no type declarations, so this
// is the one place that imports it. Everything else in the kit sees these types.
// @ts-ignore TS7016: no declaration file for a JavaScript package next door
import { lintReport } from '../../defect-report-linter/src/rules.js';

export interface DefectReport {
  source: string;
  title: string;
  severity: string;
  environment: string;
  component: string;
  steps: string[];
  expected: string;
  actual: string;
  evidence: string[];
}

export interface Finding {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface LintResult {
  source: string;
  title: string;
  findings: Finding[];
  errors: number;
  warnings: number;
  score: number;
  status: 'Ready' | 'Needs polish' | 'Not ready';
}

export const lint = (report: DefectReport): LintResult => lintReport(report) as LintResult;
