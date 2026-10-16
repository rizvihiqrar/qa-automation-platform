// Turns a defect report (Markdown or JSON) into one normalized shape:
// { source, title, severity, environment, component, steps[], expected, actual, evidence[] }

const SECTION_ALIASES = {
  steps: ['steps to reproduce', 'steps', 'reproduction steps', 'repro steps'],
  expected: ['expected result', 'expected results', 'expected', 'expected behaviour', 'expected behavior'],
  actual: ['actual result', 'actual results', 'actual', 'actual behaviour', 'actual behavior'],
  evidence: ['evidence', 'attachments', 'screenshots', 'logs'],
  environment: ['environment', 'env'],
};

const FIELD_ALIASES = {
  severity: ['severity', 'priority'],
  environment: ['environment', 'env', 'build', 'browser'],
  component: ['component', 'area', 'module'],
};

const canonical = (name, aliases) => {
  const key = name.trim().toLowerCase();
  return Object.keys(aliases).find((k) => aliases[k].includes(key)) ?? null;
};

// Strips list markers ("1.", "-", "*") from each non-empty line.
const listItems = (text) =>
  text.split('\n').map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s+/, '').trim()).filter(Boolean);

const empty = (source) => ({
  source, title: '', severity: '', environment: '', component: '', steps: [], expected: '', actual: '', evidence: [],
});

export function parseMarkdown(text, source = 'report.md') {
  const report = empty(source);
  let section = null;
  const buffers = {};

  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h1 = line.match(/^#\s+(.+)/);
    const h2 = line.match(/^##\s+(.+)/);
    const field = line.match(/^\*\*(.+?):\*\*\s*(.*)$/) ?? line.match(/^([A-Za-z ]+):\s+(.+)$/);

    if (h1 && !report.title) { report.title = h1[1].trim(); section = null; continue; }
    if (h2) { section = canonical(h2[1], SECTION_ALIASES); continue; }
    if (field && section === null) {
      const key = canonical(field[1], FIELD_ALIASES);
      if (key) { report[key] = field[2].trim(); continue; }
    }
    if (section) (buffers[section] ??= []).push(line);
  }

  const joined = (k) => (buffers[k] ?? []).join('\n').trim();
  report.steps = listItems(joined('steps'));
  report.expected = joined('expected');
  report.actual = joined('actual');
  report.evidence = listItems(joined('evidence'));
  if (!report.environment && joined('environment')) report.environment = joined('environment');
  return report;
}

const asList = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : v ? listItems(String(v)) : []);

export function parseJson(value, source = 'report.json') {
  const items = Array.isArray(value) ? value : [value];
  return items.map((r, i) => ({
    ...empty(items.length > 1 ? `${source}#${i + 1}` : source),
    title: String(r.title ?? r.summary ?? '').trim(),
    severity: String(r.severity ?? r.priority ?? '').trim(),
    environment: String(r.environment ?? r.env ?? '').trim(),
    component: String(r.component ?? '').trim(),
    steps: asList(r.steps ?? r.stepsToReproduce),
    expected: String(r.expected ?? r.expectedResult ?? '').trim(),
    actual: String(r.actual ?? r.actualResult ?? '').trim(),
    evidence: asList(r.evidence ?? r.attachments),
  }));
}

export function parseFile(text, source) {
  return source.toLowerCase().endsWith('.json') ? parseJson(JSON.parse(text), source) : [parseMarkdown(text, source)];
}
