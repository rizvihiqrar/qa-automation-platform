// Each rule looks at one normalized report and returns a finding or null.
// Errors make a report not ready to hand to a developer; warnings cost points.

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];

const words = (s) => s.trim().split(/\s+/).filter(Boolean);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isSerious = (r) => ['critical', 'high'].includes(r.severity.toLowerCase());

const GENERIC_TITLE = /^(bug|issue|error|problem|defect|broken|not working|doesn'?t work|does not work|it doesn'?t work)\b/i;
const VAGUE = /\b(doesn'?t work|does not work|not working|is broken|broken|weird|strange|something(?:'s| is)? wrong|messed up)\b/i;
const COSMETIC = /\b(typo|spelling|cosmetic|misaligned|alignment|colou?r|font|padding|spacing)\b/i;

export const RULES = [
  { id: 'title-missing', severity: 'error', check: (r) => !r.title && 'Report has no title' },
  {
    id: 'title-vague', severity: 'warning',
    check: (r) => r.title && (words(r.title).length < 4 || GENERIC_TITLE.test(r.title))
      && `Title "${r.title}" doesn't say what fails where; aim for "<what> <does what wrong> <where>"`,
  },
  { id: 'severity-missing', severity: 'error', check: (r) => !r.severity && 'No severity' },
  {
    id: 'severity-invalid', severity: 'error',
    check: (r) => r.severity && !SEVERITIES.includes(r.severity.toLowerCase())
      && `Severity "${r.severity}" isn't one of ${SEVERITIES.join(', ')}`,
  },
  { id: 'environment-missing', severity: 'warning', check: (r) => !r.environment && 'No environment (browser, OS, build or server)' },
  { id: 'steps-missing', severity: 'error', check: (r) => r.steps.length === 0 && 'No steps to reproduce' },
  { id: 'steps-too-few', severity: 'warning', check: (r) => r.steps.length === 1 && 'Only one step; someone else probably can\'t reproduce it from that' },
  { id: 'expected-missing', severity: 'error', check: (r) => !r.expected && 'No expected result' },
  { id: 'actual-missing', severity: 'error', check: (r) => !r.actual && 'No actual result' },
  {
    id: 'expected-equals-actual', severity: 'error',
    check: (r) => r.expected && r.actual && norm(r.expected) === norm(r.actual) && 'Expected and actual results are the same',
  },
  {
    id: 'actual-vague', severity: 'warning',
    check: (r) => r.actual && VAGUE.test(r.actual) && words(r.actual).length < 12
      && `Actual result "${r.actual}" is vague; describe what you saw (message, value, screen)`,
  },
  {
    id: 'evidence-missing', severity: 'warning',
    check: (r) => isSerious(r) && r.evidence.length === 0 && `${r.severity} defect has no screenshot, log or attachment`,
  },
  {
    id: 'severity-mismatch', severity: 'warning',
    check: (r) => isSerious(r) && COSMETIC.test(`${r.title} ${r.actual}`)
      && `Marked ${r.severity} but reads like a cosmetic issue; check the severity`,
  },
];

export function lintReport(report, rules = RULES) {
  const findings = rules
    .map((rule) => { const message = rule.check(report); return message ? { rule: rule.id, severity: rule.severity, message } : null; })
    .filter(Boolean);
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  const score = Math.max(0, 100 - 25 * errors - 10 * warnings);
  const status = errors > 0 ? 'Not ready' : score >= 90 ? 'Ready' : 'Needs polish';
  return { source: report.source, title: report.title, findings, errors, warnings, score, status };
}
