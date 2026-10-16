// Builds findings from page results and writes the audit report.
import { criteriaFromTags, scName, fixFor, AODA_NOTE } from './wcag.js';

// pages: [{ page, axe: [...], focus: [...], placeholders: [...] }]
export function buildFindings(pages) {
  const byRule = new Map();
  const add = (rule, info, pageName, targets) => {
    const f = byRule.get(rule) ?? { rule, ...info, pages: new Set(), count: 0, examples: [] };
    f.pages.add(pageName);
    f.count += targets.length;
    for (const t of targets) if (f.examples.length < 3) f.examples.push(`${pageName}: ${t}`);
    byRule.set(rule, f);
  };
  for (const p of pages) {
    for (const v of p.axe) {
      const { criteria, level } = criteriaFromTags(v.tags);
      add(v.rule, { criteria, level, impact: v.impact, help: v.help }, p.page, v.targets);
    }
    for (const f of [...p.focus, ...p.placeholders]) {
      add(f.rule, { criteria: f.criteria, level: f.level, impact: f.rule === 'focus-not-visible' ? 'serious' : 'moderate', help: f.rule === 'focus-not-visible' ? 'Keyboard focus is not visible' : 'Field is labelled only by a placeholder' }, p.page, [f.target]);
    }
  }
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  return [...byRule.values()]
    .map((f) => ({ ...f, pages: [...f.pages].sort() }))
    .sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9) || a.rule.localeCompare(b.rule));
}

export function toMarkdown({ version, pages, findings }) {
  const total = findings.reduce((n, f) => n + f.count, 0);
  const lines = [
    `# Accessibility audit: ${version}`,
    '',
    `${pages.length} page(s) checked against WCAG 2.0 A/AA rules, plus keyboard focus and placeholder-only labels.`,
    '',
    total === 0 ? '**No issues found.**' : `**${findings.length} issue type(s), ${total} instance(s).**`,
  ];
  if (findings.length) {
    lines.push('', '| Impact | Issue | WCAG | Level | Count | Pages | Fix |', '|---|---|---|---|---:|---|---|');
    for (const f of findings) {
      const sc = f.criteria.map((c) => `${c} ${scName(c)}`.trim()).join('; ') || '—';
      lines.push(`| ${f.impact ?? '—'} | ${f.help} | ${sc} | ${f.level ?? '—'} | ${f.count} | ${f.pages.join(', ')} | ${fixFor(f.rule)} |`);
    }
  }
  lines.push('', '## AODA context', '', AODA_NOTE);
  return lines.join('\n') + '\n';
}
